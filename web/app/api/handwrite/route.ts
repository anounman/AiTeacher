import { NextResponse } from "next/server";

// Proxy to the mathwriter sidecar (mathwriter/server.py, port 8931 — real
// handwritten glyph rendering by github.com/JayanshJ/mathwriter). 503 when
// the sidecar is down; the board falls back to plain text.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  try {
    const res = await fetch("http://127.0.0.1:8931/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "mathwriter sidecar not running (npm run writer)" },
      { status: 503 },
    );
  }
}
