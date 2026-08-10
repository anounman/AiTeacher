import { NextResponse } from "next/server";

// The traced handwriting atlas: every glyph outline as an SVG path, fetched
// ONCE per session. Board renders then ship only `<use href="#g…">`
// references (~2 KB) instead of a bitmap each (~6-14 KB), and the same
// outlines stay sharp at any zoom or device pixel ratio.
//
// Immutable caching is safe because the payload is content-addressed: the
// sidecar regenerates it whenever the glyph dataset or tracer version
// changes, and the `source` field in the body identifies the build.
export async function GET() {
  try {
    const res = await fetch("http://127.0.0.1:8931/glyphs", {
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `atlas ${res.status}` }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        // Long-lived: a changed dataset changes `source`, and the client
        // re-requests only when its cached build no longer covers a glyph.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "mathwriter sidecar not running (npm run writer)" },
      { status: 503 },
    );
  }
}
