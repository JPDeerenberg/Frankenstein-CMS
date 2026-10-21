// Supabase Edge Function - Frankenstein CMS Bouncer
// Deploy this to Supabase Functions WITHOUT JWT verification, because the CMS
// authenticates with Site-Email / Site-Password, not a Supabase JWT:
//   supabase functions deploy bouncer --no-verify-jwt
//
// Supports password auth and short-lived HMAC session tokens so the
// site password is not sent on every request after the first login.
// Session TTL: 8 hours.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  encode as b64encode,
  decode as b64decode,
} from "https://deno.land/std@0.208.0/encoding/base64url.ts";

const corsHeaders: Record<string, string> = {
  // Set ALLOWED_ORIGIN (function secret) to your CMS origin to restrict CORS
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Methods": "GET, HEAD, PUT, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Site-Email, Site-Password, Site-Session, Accept",
  "Access-Control-Expose-Headers":
    "X-Session-Token, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After",
};

const SESSION_TTL_SEC = 28800; // 8 hours

// BOUNCER-GUARD-START
// Whitelist of GitHub requests the CMS may make through this bouncer.
// Mirrors github_request_allowed() in bouncer.php and bouncer-node.js
// (tests/bouncer.test.js keeps the implementations in sync).
function isAllowedGithubRequest(
  method: string,
  rawPath: string,
  owner?: string | null,
  repo?: string | null,
): boolean {
  method = method.toUpperCase();
  if (/[\x00-\x20\\]/.test(rawPath)) return false;
  const pathPart = rawPath.split("?")[0];
  const pathname = pathPart.startsWith("/") ? pathPart : "/" + pathPart;
  const segments = pathname.split("/").filter((s) => s !== "");
  const decoded: string[] = [];
  for (const s of segments) {
    let d = s;
    try {
      d = decodeURIComponent(s);
    } catch {
      d = s;
    }
    if (d === "." || d === ".." || d.includes("/") || d.includes("\\")) {
      return false;
    }
    decoded.push(d);
  }
  if (segments.length < 3 || segments[0] !== "repos") return false;
  if (owner && decoded[1].toLowerCase() !== owner.toLowerCase()) return false;
  if (repo && decoded[2].toLowerCase() !== repo.toLowerCase()) return false;
  const readOnly = method === "GET" || method === "HEAD";
  if (segments.length === 3) return readOnly;
  switch (segments[3]) {
    case "contents":
      return readOnly || method === "PUT";
    case "commits":
      return readOnly;
    case "git":
      return readOnly && (segments[4] === "blobs" || segments[4] === "trees");
    default:
      return false;
  }
}
// BOUNCER-GUARD-END

function safeEqual(a: string, b: string): boolean {
  // constant-time comparison (length is not secret here)
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return b64encode(new Uint8Array(sig));
}

async function makeSessionToken(
  email: string,
  password: string,
): Promise<string> {
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_TTL_SEC);
  const payload = `${b64encode(new TextEncoder().encode(email))}.${b64encode(new TextEncoder().encode(exp))}`;
  const sig = await hmacSign(payload, Deno.env.get("HMAC_SECRET") || password);
  return `${payload}.${sig}`;
}

async function verifySessionToken(
  token: string,
  email: string,
  password: string,
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [eB64, expB64, sig] = parts;
  try {
    const tokenEmail = new TextDecoder().decode(b64decode(eB64));
    const exp = parseInt(new TextDecoder().decode(b64decode(expB64)), 10);
    if (tokenEmail !== email) return false;
    if (isNaN(exp) || exp < Math.floor(Date.now() / 1000)) return false;
    const payload = `${eB64}.${expB64}`;
    const expected = await hmacSign(
      payload,
      Deno.env.get("HMAC_SECRET") || password,
    );
    return expected === sig;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const githubPath = url.searchParams.get("path") || "/";

    const clientEmail = req.headers.get("Site-Email");
    const clientPassword = req.headers.get("Site-Password");
    const clientSession = req.headers.get("Site-Session");

    if (!clientEmail) {
      return new Response("Missing Site-Email", {
        status: 400,
        headers: corsHeaders,
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: site, error } = await supabase
      .from("sites")
      .select("*")
      .eq("site_email", clientEmail)
      .single();

    if (error || !site) {
      console.error("Site not found:", clientEmail, error);
      return new Response("Unauthorized: Site not configured", {
        status: 401,
        headers: corsHeaders,
      });
    }

    let authenticated = false;
    let issueSession = false;

    if (
      clientSession &&
      (await verifySessionToken(clientSession, clientEmail, site.site_password))
    ) {
      authenticated = true;
    } else if (
      clientPassword &&
      safeEqual(clientPassword, site.site_password)
    ) {
      authenticated = true;
      issueSession = true;
    }

    if (!authenticated) {
      await new Promise((r) => setTimeout(r, 2000));
      return new Response("Unauthorized: Incorrect credentials", {
        status: 401,
        headers: corsHeaders,
      });
    }

    if (
      !isAllowedGithubRequest(
        req.method,
        githubPath,
        site.github_owner,
        site.github_repo,
      )
    ) {
      return new Response(
        JSON.stringify({ message: "Bouncer: this request is not allowed." }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const safePath = githubPath.startsWith("/") ? githubPath : `/${githubPath}`;
    const targetUrl = `https://api.github.com${safePath}`;

    // Build the upstream headers from scratch. Copying the client's headers
    // (and then overwriting Accept) broke raw file requests, and leaked
    // browser headers (Origin, Cookie …) to GitHub.
    const proxyHeaders = new Headers();
    proxyHeaders.set("Authorization", `Bearer ${site.github_token}`);
    proxyHeaders.set(
      "Accept",
      req.headers.get("Accept") || "application/vnd.github+json",
    );
    proxyHeaders.set("User-Agent", "Frankenstein-CMS-Supabase-Bouncer");
    const contentType = req.headers.get("Content-Type");
    if (contentType) proxyHeaders.set("Content-Type", contentType);

    const proxyInit: RequestInit = {
      method: req.method,
      headers: proxyHeaders,
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      proxyInit.body = await req.clone().arrayBuffer();
    }

    const response = await fetch(targetUrl, proxyInit);

    const resHeaders = new Headers(response.headers);
    for (const k in corsHeaders) {
      resHeaders.set(k, corsHeaders[k]);
    }
    if (issueSession) {
      resHeaders.set(
        "X-Session-Token",
        await makeSessionToken(clientEmail, site.site_password),
      );
    }

    return new Response(response.body, {
      status: response.status,
      headers: resHeaders,
    });
  } catch (err: any) {
    console.error("Bouncer Exception:", err);
    return new Response(`Bouncer Error: ${err.message}`, {
      status: 500,
      headers: corsHeaders,
    });
  }
});
