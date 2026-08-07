// Supabase Edge Function - Frankenstein CMS Bouncer
// Deploy this to Supabase Functions
//
// Supports password auth and short-lived HMAC session tokens so the
// site password is not sent on every request after the first login.
// Session TTL: 8 hours.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as b64encode, decode as b64decode } from "https://deno.land/std@0.208.0/encoding/base64url.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE, PATCH",
  "Access-Control-Allow-Headers":
    "Content-Type, Site-Email, Site-Password, Site-Session, Accept",
  "Access-Control-Expose-Headers": "X-Session-Token",
};

const SESSION_TTL_SEC = 28800; // 8 hours

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

async function makeSessionToken(email: string, password: string): Promise<string> {
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
    const expected = await hmacSign(payload, Deno.env.get("HMAC_SECRET") || password);
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
    } else if (clientPassword && clientPassword === site.site_password) {
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

    const safePath = githubPath.startsWith("/") ? githubPath : `/${githubPath}`;
    const targetUrl = `https://api.github.com${safePath}`;

    const proxyHeaders = new Headers(req.headers);
    proxyHeaders.set("Authorization", `Bearer ${site.github_token}`);
    proxyHeaders.set("Accept", "application/vnd.github.v3+json");
    proxyHeaders.set("User-Agent", "Frankenstein-CMS-Supabase-Bouncer");
    proxyHeaders.delete("Site-Email");
    proxyHeaders.delete("Site-Password");
    proxyHeaders.delete("Site-Session");
    proxyHeaders.delete("Host");

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
