/**
 * Frankenstein CMS - Serverless Bouncer (Cloudflare Worker)
 *
 * This worker acts as a secure proxy between Frankenstein CMS and the GitHub API.
 * It expects a `Site-Email` and `Site-Password` header from the client.
 * If they match the `CLIENT_EMAIL` and `CLIENT_PASSWORD` secrets, it injects the `GITHUB_TOKEN`
 * secret and forwards the request to GitHub.
 */

export default {
  async fetch(request, env) {
    // 1. Handle CORS Preflight requests
    if (request.method === "OPTIONS") {
      return handleCORS(request);
    }

    // 2. Extract client password and target GitHub path
    const url = new URL(request.url);
    const githubPath =
      url.searchParams.get("path") || url.pathname.replace(/^\/proxy/, "");

    // Check for email and password in headers
    const clientEmail = request.headers.get("Site-Email");
    const clientPassword = request.headers.get("Site-Password");

    // 3. Authenticate the Client
    let githubToken = env.GITHUB_TOKEN;
    let allowedPassword = env.CLIENT_PASSWORD;
    let allowedEmail = env.CLIENT_EMAIL;

    // Check Cloudflare KV for multi-tenant config if available
    if (env.CONFIG_KV && clientEmail) {
      const kvData = await env.CONFIG_KV.get(clientEmail);
      if (kvData) {
        try {
          const config = JSON.parse(kvData);
          allowedEmail = clientEmail;
          allowedPassword = config.password || config.CLIENT_PASSWORD;
          githubToken = config.github_token || config.GITHUB_TOKEN;
        } catch (e) {
          console.error("KV parsing error", e);
        }
      }
    }

    if (!allowedEmail || !allowedPassword) {
      return new Response(
        "Bouncer misconfigured: Missing authentication credentials",
        { status: 500, headers: corsHeaders() },
      );
    }

    if (!githubToken) {
      return new Response("Bouncer misconfigured: Missing GITHUB_TOKEN", {
        status: 500,
        headers: corsHeaders(),
      });
    }

    if (clientEmail !== allowedEmail || clientPassword !== allowedPassword) {
      // Artificial delay to deter brute-force
      await new Promise((r) => setTimeout(r, 2000));
      return new Response("Unauthorized: Incorrect Email or Password", {
        status: 401,
        headers: corsHeaders(),
      });
    }

    // 4. Construct the GitHub API Request
    // Ensure the path starts with a slash
    const safePath = githubPath.startsWith("/") ? githubPath : `/${githubPath}`;
    const targetUrl = `https://api.github.com${safePath}`;

    // Clone the original request to modify headers safely
    const proxyHeaders = new Headers(request.headers);
    proxyHeaders.set("Authorization", `Bearer ${githubToken}`);
    proxyHeaders.set("Accept", "application/vnd.github.v3+json");
    proxyHeaders.set("User-Agent", "Frankenstein-CMS-Bouncer");

    // Remove headers we don't want to forward to GitHub
    proxyHeaders.delete("Site-Email");
    proxyHeaders.delete("Site-Password");
    proxyHeaders.delete("Host");
    proxyHeaders.delete("Origin");

    const proxyInit = {
      method: request.method,
      headers: proxyHeaders,
    };

    // Forward the body if it's not a GET or HEAD request
    if (request.method !== "GET" && request.method !== "HEAD") {
      proxyInit.body = await request.clone().text();
    }

    // 5. Fire the Request to GitHub
    try {
      const response = await fetch(targetUrl, proxyInit);

      // Clone the response so we can add CORS headers before sending back to client
      const responseClone = new Response(response.body, response);

      // Add CORS headers to the final response
      Object.entries(corsHeaders()).forEach(([key, value]) => {
        responseClone.headers.set(key, value);
      });

      return responseClone;
    } catch (e) {
      return new Response(`Bouncer Error: ${e.message}`, {
        status: 500,
        headers: corsHeaders(),
      });
    }
  },
};

// --- Helper Functions ---

const corsHeaders = () => ({
  "Access-Control-Allow-Origin": "*", // Or specific domain e.g. "https://my-agency.com"
  "Access-Control-Allow-Methods":
    "GET, HEAD, POST, OPTIONS, PUT, DELETE, PATCH",
  "Access-Control-Allow-Headers":
    "Content-Type, Site-Email, Site-Password, Accept",
});

function handleCORS(request) {
  // Make sure the necessary headers are present for this response.
  let headers = request.headers;
  if (
    headers.get("Origin") !== null &&
    headers.get("Access-Control-Request-Method") !== null &&
    headers.get("Access-Control-Request-Headers") !== null
  ) {
    // Handle CORS preflight requests.
    return new Response(null, {
      headers: corsHeaders(),
    });
  } else {
    // Handle standard OPTIONS request.
    return new Response(null, {
      headers: {
        Allow: "GET, HEAD, POST, OPTIONS, PUT, DELETE, PATCH",
      },
    });
  }
}
