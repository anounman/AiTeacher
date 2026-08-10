import { lookup } from "node:dns/promises";

// Server-Side Request Forgery guard for user-supplied URLs (materials ingestion
// from a URL). Before fetching we (1) reject non-http(s) schemes, (2) resolve
// the hostname and block any address in a private / loopback / link-local /
// metadata / reserved range, and (3) follow redirects MANUALLY, re-running the
// full check on each Location — so an attacker can't bypass with a public URL
// that 302s to 169.254.169.254 or an internal host.
//
// Residual: this does not pin the resolved IP into the actual TCP connection,
// so a DNS-rebinding response (public at check time, private at fetch time) can
// still escape. Closing that needs a custom dispatcher that connects to the
// verified IP; out of scope for the local single-user MVP. Documented so it
// isn't mistaken for a complete fix.

const MAX_REDIRECTS = 5;
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

// True if an IPv4 address falls in a range we must not fetch from. Permissive
// by default (public unicast allowed); blocks every non-routable / internal
// range plus multicast and reserved.
function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return true;
  const o = parts.map((p) => Number(p));
  if (o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = o;
  if (a === 0) return true; // 0.0.0.0/8 "this" network
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // 127/8 loopback
  if (a === 169 && b === 254) return true; // 169.254/16 link-local (incl. cloud IMDS)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a >= 224) return true; // 224/4 multicast + 240/4 reserved
  return false;
}

// Expand a ::-compressed IPv6 address into 8 hex groups, or null if malformed.
function expandIpv6(addr: string): string[] | null {
  const halves = addr.split("::");
  if (halves.length === 1) {
    const groups = halves[0] ? halves[0].split(":") : [];
    if (groups.length !== 8) return null;
    return groups.every((h) => /^[0-9a-f]{1,4}$/.test(h)) ? groups : null;
  }
  if (halves.length !== 2) return null; // multiple :: is invalid
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const expanded = [...head, ...Array<string>(missing).fill("0"), ...tail];
  if (expanded.length !== 8) return null;
  return expanded.every((h) => /^[0-9a-f]{1,4}$/.test(h)) ? expanded : null;
}

// True if an IPv6 address is internal/loopback/link-local/etc. IPv4-mapped
// addresses (::ffff:a.b.c.d) delegate to the v4 check — the routed address is
// the embedded v4.
function isBlockedIpv6(ip: string): boolean {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone >= 0) addr = addr.slice(0, zone); // strip zone id (%eth0)

  const v4Match = addr.match(/:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Match) return isBlockedIpv4(v4Match[1]);

  const groups = expandIpv6(addr);
  if (!groups) return true; // unparseable → block
  const g = groups.map((h) => parseInt(h, 16));

  if (g.every((v) => v === 0)) return true; // :: unspecified
  if (g.every((v, i) => (i === 7 ? v === 1 : v === 0))) return true; // ::1 loopback
  if ((g[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (g[0] === 0xfe && (g[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff) === 0xff) return true; // ff00::/8 multicast
  return false;
}

function isBlockedAddress(address: string, family: number): boolean {
  return family === 4 ? isBlockedIpv4(address) : isBlockedIpv6(address);
}

// Parse + scheme check + resolve + range check. Throws on anything disallowed.
async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new Error(`URL scheme not allowed: ${url.protocol}`);
  }
  if (!url.hostname) throw new Error("URL is missing a hostname");

  const addrs = await lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
  if (addrs.length === 0) throw new Error(`Could not resolve hostname: ${url.hostname}`);
  for (const a of addrs) {
    if (isBlockedAddress(a.address, a.family)) {
      throw new Error(`Refusing to fetch internal address (${url.hostname} → ${a.address})`);
    }
  }
  return url;
}

// fetch() wrapper that enforces the SSRF guards and follows redirects itself
// (with the same guards applied to each hop) instead of letting fetch follow
// them blindly. Returns the final non-redirect response.
export async function safeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let current = await assertSafeUrl(url);
  let res = await fetch(current, { ...init, redirect: "manual" });
  for (let i = 0; i < MAX_REDIRECTS && res.status >= 300 && res.status < 400; i++) {
    const location = res.headers.get("location");
    if (!location) break;
    current = await assertSafeUrl(new URL(location, current).toString());
    res = await fetch(current, { ...init, redirect: "manual" });
  }
  if (res.status >= 300 && res.status < 400) {
    throw new Error("Too many redirects");
  }
  return res;
}