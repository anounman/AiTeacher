import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const SECURE_APP_HOST =
  process.env.SECURE_APP_HOST ?? "ankushs-macbook-air-2.tailebdc02.ts.net";

const insecureAppHosts = new Set(
  (process.env.INSECURE_APP_HOSTS ?? "100.122.212.123,192.168.0.102")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean),
);

// Direct IP/LAN links work for reading the app but browsers deliberately deny
// microphone capture on those insecure origins. Redirect top-level page loads
// to Tailscale Serve, which supplies a trusted tailnet-only HTTPS certificate.
export function proxy(request: NextRequest) {
  const isDocumentNavigation =
    request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
  // In local development Next may normalize nextUrl.hostname to localhost;
  // the original Host header still contains the address the iPad opened.
  const requestHost = (request.headers.get("host") ?? request.nextUrl.hostname)
    .replace(/^\[|\]$/g, "")
    .split(":")[0]!
    .toLowerCase();

  if (isDocumentNavigation && insecureAppHosts.has(requestHost)) {
    const secureUrl = request.nextUrl.clone();
    secureUrl.protocol = "https:";
    secureUrl.hostname = SECURE_APP_HOST;
    secureUrl.port = "";
    return NextResponse.redirect(secureUrl, 307);
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/:path*",
};
