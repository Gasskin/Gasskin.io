const DEFAULT_UPSTREAM = "https://api.openai.com";
const ALLOWED_UPSTREAMS = [
  "https://api.openai.com",
  "https://flux.infpro.me",
  "https://ai.input.im",
];
const ALLOWED_METHODS = "GET, HEAD, POST, OPTIONS";
const ALLOWED_HEADERS = "Authorization, Content-Type";

function corsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function withCors(response, request) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders(request)).forEach(([key, value]) => {
    headers.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function cleanBaseUrl(value) {
  return (value || "").trim().replace(/\/+$/, "");
}

function getAllowedUpstream(value) {
  const baseUrl = cleanBaseUrl(value || DEFAULT_UPSTREAM);
  if (!ALLOWED_UPSTREAMS.includes(baseUrl)) {
    return null;
  }
  return baseUrl;
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      });
    }

    const incomingUrl = new URL(request.url);
    if (!incomingUrl.pathname.startsWith("/v1/")) {
      return new Response("Not Found", {
        status: 404,
        headers: corsHeaders(request),
      });
    }

    const upstreamBaseUrl = getAllowedUpstream(incomingUrl.searchParams.get("target"));
    if (!upstreamBaseUrl) {
      return new Response("Target API is not allowed", {
        status: 403,
        headers: corsHeaders(request),
      });
    }

    incomingUrl.searchParams.delete("target");
    const upstreamUrl = new URL(incomingUrl.pathname + incomingUrl.search, upstreamBaseUrl);

    const headers = new Headers(request.headers);
    headers.delete("Host");
    headers.delete("Origin");
    headers.delete("Referer");

    const upstreamInit = {
      method: request.method,
      headers,
      redirect: "manual",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      upstreamInit.body = request.body;
    }

    const upstreamRequest = new Request(upstreamUrl, upstreamInit);

    const response = await fetch(upstreamRequest);
    return withCors(response, request);
  },
};
