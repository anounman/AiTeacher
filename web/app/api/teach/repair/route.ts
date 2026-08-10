import { NextResponse } from "next/server";
import { updateMessageContent } from "@/lib/db";
import { parseTeachEvents } from "@/lib/teach/protocol";

// Render QA for the board's hand-drawn items, on the DEFAULT teach path.
//
// The loop itself lives in the teacher service (app/performance/render_qa.py):
// render each diagram, look at it with the vision slot, and if it is genuinely
// broken have the reason model rewrite the markup. Until now it was reachable
// only when the deepagents tutor was enabled, which is why it had never
// actually run on a real lesson.
//
// Called after a lesson finishes, like the visualize pass. It rewrites the
// stored lesson so a reload shows the repaired board; the already-performed
// lesson is left alone, because swapping strokes out from under a student
// mid-playback is worse than a diagram that came out badly.
const TEACHER_URL = process.env.TEACHER_URL ?? "http://127.0.0.1:8900";

// Diagram markup only. Prose handwriting has no composition failure mode worth
// two model calls per line.
const DIAGRAM = /\[(?:G|DRAW|T)\]/;

interface RepairResponse {
  markup: string;
  changed: boolean;
  verdict: { ok: boolean; severity: string; problems: string[] };
}

export async function POST(req: Request) {
  let body: { lessonMd?: unknown; messageId?: unknown };
  try {
    body = (await req.json()) as { lessonMd?: unknown; messageId?: unknown };
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const lessonMd = typeof body.lessonMd === "string" ? body.lessonMd : "";
  if (!lessonMd.trim() || lessonMd.length > 200_000) {
    return NextResponse.json({ error: "lessonMd required, under 200 KB" }, { status: 400 });
  }
  const messageId =
    typeof body.messageId === "string" && body.messageId.length <= 100 ? body.messageId : undefined;

  const targets = new Set<string>();
  for (const event of parseTeachEvents(lessonMd, true)) {
    if (event.kind !== "draw" || event.action.type !== "write") continue;
    if (DIAGRAM.test(event.action.markup)) targets.add(event.action.markup);
  }
  if (!targets.size) {
    return NextResponse.json({ checked: 0, changed: 0, report: [], lessonMd });
  }

  // Bounded: four diagrams, concurrently, with a deadline. Quality control
  // that delays the next lesson is a worse defect than the ones it catches.
  const list = [...targets].slice(0, 4);
  const results = await Promise.all(
    list.map(async (markup) => {
      try {
        const res = await fetch(`${TEACHER_URL}/performance/repair-markup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ markup, scale: 1.0 }),
          signal: AbortSignal.timeout(90_000),
        });
        if (!res.ok) return null;
        return (await res.json()) as RepairResponse;
      } catch {
        return null;
      }
    }),
  );

  let repaired = lessonMd;
  let changed = 0;
  const report: { before: string; severity: string; problems: string[]; fixed: boolean }[] = [];
  for (const [index, result] of results.entries()) {
    if (!result) continue;
    const before = list[index]!;
    report.push({
      before: before.slice(0, 80),
      severity: result.verdict.severity,
      problems: result.verdict.problems,
      fixed: result.changed,
    });
    if (result.changed && result.markup) {
      // The markup is a JSON string value inside a ```board fence, so it is
      // replaced through JSON encoding rather than raw — a raw swap would
      // break every escape in it.
      const from = JSON.stringify(before).slice(1, -1);
      const to = JSON.stringify(result.markup).slice(1, -1);
      if (repaired.includes(from)) {
        repaired = repaired.split(from).join(to);
        changed++;
      }
    }
  }

  if (changed && messageId) updateMessageContent(messageId, repaired);
  return NextResponse.json({ checked: list.length, changed, report, lessonMd: repaired });
}
