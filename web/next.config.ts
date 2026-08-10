import type { NextConfig } from "next";

// `next dev` rejects JavaScript/HMR requests whose browser-facing host differs
// from the host that started the server. That leaves a routed iPad with HTML
// but no hydrated React click handlers. Keep the known LAN/Tailscale hosts
// explicit, and allow additional private hosts through a comma-separated env
// override without opening development assets to arbitrary origins.
const configuredDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "192.168.0.102",
    "100.122.212.123",
    "ankushs-macbook-air.local",
    "ankushs-macbook-air-2.tailebdc02.ts.net",
    "*.tailebdc02.ts.net",
    ...configuredDevOrigins,
  ],
  // Keep these on Node instead of bundling them.
  // - better-sqlite3: native module.
  // - tesseract.js: spawns worker_threads and resolves its wasm core / worker
  //   script / lang data relative to its package at runtime; bundling under
  //   turbopack breaks that resolution and hangs createWorker. Externalizing
  //   lets Node require the real package path so the worker spawns correctly.
  serverExternalPackages: ["better-sqlite3", "tesseract.js"],
};

export default nextConfig;
