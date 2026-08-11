import { NextResponse } from "next/server";

// Serves a rendered animation clip from the teacher service.
//
// Proxied rather than linked directly: on an iPad over Tailscale, 127.0.0.1 is
// the iPad, so anything the browser fetches has to come from the app's own
// origin. The body is streamed rather than buffered — these are video files,
// and Range requests are what make a <video> element seekable.
const TEACHER_URL = process.env.TEACHER_URL ?? "http://127.0.0.1:8900";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Content-addressed ids only. This value ends up in a filesystem path on the
  // other side, so anything that is not a hash is refused here.
  if (!/^[a-f0-9]{8,64}$/.test(id)) {
    return NextResponse.json({ error: "bad clip id" }, { status: 400 });
  }

  const range = req.headers.get("range");
  try {
    const upstream = await fetch(`${TEACHER_URL}/clips/${id}.mp4`, {
      headers: range ? { Range: range } : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json({ error: `clip ${upstream.status}` }, { status: upstream.status });
    }
    const headers = new Headers();
    for (const key of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(key);
      if (value) headers.set(key, value);
    }
    // Content-addressed: the bytes for an id can never change.
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return NextResponse.json({ error: "teacher service unreachable" }, { status: 503 });
  }
}
