const CONTROL_UI_ORIGIN = "http://127.0.0.1:18789";

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);

type ControlRouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

function buildControlUrl(request: Request, pathParts: string[] = []): string {
  const requestUrl = new URL(request.url);
  const upstream = new URL(CONTROL_UI_ORIGIN);
  upstream.pathname = `/${pathParts.map(encodeURIComponent).join("/")}`;
  upstream.search = requestUrl.search;
  return upstream.toString();
}

function buildProxyHeaders(request: Request): Headers {
  const headers = new Headers();

  request.headers.forEach((value, key) => {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  headers.set("x-forwarded-host", request.headers.get("host") ?? "");
  headers.set("x-forwarded-proto", "https");

  return headers;
}

function rewriteControlLocation(location: string): string {
  if (location.startsWith(CONTROL_UI_ORIGIN)) {
    const path = location.slice(CONTROL_UI_ORIGIN.length);
    return path === "/" ? "/control/" : `/control${path}`;
  }

  if (location === "/") {
    return "/control/";
  }

  if (location.startsWith("/") && !location.startsWith("/control/")) {
    return `/control${location}`;
  }

  return location;
}

async function proxyControlRequest(
  request: Request,
  context: ControlRouteContext
): Promise<Response> {
  const { path } = await context.params;
  const method = request.method.toUpperCase();
  const upstream = await fetch(buildControlUrl(request, path), {
    method,
    headers: buildProxyHeaders(request),
    body: method === "GET" || method === "HEAD" ? undefined : request.body,
    duplex: method === "GET" || method === "HEAD" ? undefined : "half",
    redirect: "manual",
  } as RequestInit & { duplex?: "half" });

  const responseHeaders = new Headers(upstream.headers);
  const location = responseHeaders.get("location");

  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");

  if (location) {
    responseHeaders.set("location", rewriteControlLocation(location));
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export function GET(request: Request, context: ControlRouteContext) {
  return proxyControlRequest(request, context);
}

export function POST(request: Request, context: ControlRouteContext) {
  return proxyControlRequest(request, context);
}

export function PUT(request: Request, context: ControlRouteContext) {
  return proxyControlRequest(request, context);
}

export function PATCH(request: Request, context: ControlRouteContext) {
  return proxyControlRequest(request, context);
}

export function DELETE(request: Request, context: ControlRouteContext) {
  return proxyControlRequest(request, context);
}
