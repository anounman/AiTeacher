import { NextResponse } from "next/server";

// One honest status for the whole system. The teacher service already probes
// its own dependencies (postgres, ollama, writer engine), so this route asks
// it once and adds what only the web process knows.
//
// This is also the first route to cross the web → teacher boundary
// (ARCHITECTURE_V2 §1). Everything else migrates behind it.
const TEACHER_URL = process.env.TEACHER_URL ?? "http://127.0.0.1:8900";

export async function GET() {
  let teacher: unknown;
  try {
    const res = await fetch(`${TEACHER_URL}/health`, {
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    teacher = await res.json();
  } catch {
    teacher = { service: "teacher", ok: false, error: "unreachable (npm run teacher)" };
  }

  const ok = (teacher as { ok?: boolean })?.ok === true;
  return NextResponse.json({ service: "web", ok, teacher }, { status: ok ? 200 : 503 });
}
