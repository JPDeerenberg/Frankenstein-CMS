// Supabase Edge Function - Frankenstein CMS Bouncer
// Deploy this to Supabase Functions

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE, PATCH",
  "Access-Control-Allow-Headers": "Content-Type, Site-Email, Site-Password, Accept",
};

Deno.serve(async (req) => {
  // 1. Handle CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const githubPath = url.searchParams.get("path") || "/";

    // 2. Extract credentials from headers
    const clientEmail = req.headers.get("Site-Email");
    const clientPassword = req.headers.get("Site-Password");

    if (!clientEmail || !clientPassword) {
      return new Response("Missing Site-Email or Site-Password", {
        status: 400,
        headers: corsHeaders,
      });
    }

    // 3. Initialize Supabase Client with Service Role (to bypass RLS)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 4. Look up site configuration
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

    // 5. Verify Password
    if (clientPassword !== site.site_password) {
      // Artificial delay
      await new Promise((r) => setTimeout(r, 2000));
      return new Response("Unauthorized: Incorrect Password", {
        status: 401,
        headers: corsHeaders,
      });
    }

    // 6. Construct GitHub API Request
    const safePath = githubPath.startsWith("/") ? githubPath : `/${githubPath}`;
    const targetUrl = `https://api.github.com${safePath}`;

    const proxyHeaders = new Headers(req.headers);
    proxyHeaders.set("Authorization", `Bearer ${site.github_token}`);
    proxyHeaders.set("Accept", "application/vnd.github.v3+json");
    proxyHeaders.set("User-Agent", "Frankenstein-CMS-Supabase-Bouncer");

    // Clean up internal headers
    proxyHeaders.delete("Site-Email");
    proxyHeaders.delete("Site-Password");
    proxyHeaders.delete("Host");

    const proxyInit: RequestInit = {
      method: req.method,
      headers: proxyHeaders,
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      proxyInit.body = await req.clone().arrayBuffer();
    }

    // 7. Proxy to GitHub
    const response = await fetch(targetUrl, proxyInit);
    
    // Add CORS to response
    const resHeaders = new Headers(response.headers);
    for (const k in corsHeaders) {
      resHeaders.set(k, (corsHeaders as any)[k]);
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
