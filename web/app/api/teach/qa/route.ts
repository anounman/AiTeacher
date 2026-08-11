import { NextResponse } from "next/server";
import { generateText } from "ai";
import { slotModel } from "@/lib/llm/slots";
import { updateMessageContent } from "@/lib/db";
import { parseTeachEvents } from "@/lib/teach/protocol";

// Mid-lesson quality gate, fired by the stage once ~60% of the lesson has
// been delivered: the reason slot re-reads what the teacher has said and
// written and judges (a) is the content correct, (b) does the board read
// well. A bad verdict produces a SHORT correction in the normal teach format;
// the route appends it to the stored lesson and returns it, and the client
// appends it to the live message so the performer simply keeps playing into
// the correction — the teacher says "wait, let me fix that" in its own voice.
//
// Never gates playback: the lesson continues while this runs, and any failure
// here returns ok:true. Bounded to one check and at most one correction per
// lesson (client enforces the once; the cap here bounds the correction size).

const MAX_CORRECTION_CHARS = 1200;

const QA_PROMPT = `You are the quality controller for a whiteboard tutor. Below is the lesson so far: spoken lines and the board actions (JSON) the tutor wrote.

The board markup is mathwriter, NOT markdown. Do not "fix" its notation — these are all correct and intentional:
- \`~~Text~~\` is an UNDERLINED HEADING (never strikethrough).
- \`[F]a|b[/F]\` is a fraction, \`[R]x[/R]\` a square root, \`[B]x[/B]\` bold, \`[X]x[/X]\` crossed-out working.
- \`[G]{...}[/G]\` and \`[DRAW]...[/DRAW]\` are hand-drawn figures.
- Superscripts/subscripts as written (x², e⁻) are fine.

Check, in order of importance:
1. CORRECTNESS — any mathematical or factual error in what was said or written.
2. BOARD QUALITY — writing that contradicts the speech, duplicated lines, a formula with wrong symbols.

Report ONLY errors a student would be taught wrong by. Never comment on notation, styling, or markup syntax.

Reply with STRICT JSON only, no prose around it:
{"ok": true}
or
{"ok": false, "issue": "<one sentence>", "correctionMd": "<correction>"}

correctionMd rules (teach format):
- 1-2 short spoken sentences, starting by owning the mistake naturally ("Hold on — I wrote that wrong. ...").
- Then AT MOST ONE \`\`\`board fence with a JSON array of actions, EXACTLY like the lesson's own fences, e.g.:
\`\`\`board
[{"type":"write","id":"fix1","color":"red","markup":"2 + 2 = 4"}]
\`\`\`
- Use a NEW unique id. Never erase; add the corrected line (red ink reads as a teacher's correction).
- Under ${MAX_CORRECTION_CHARS} characters total. If nothing is genuinely wrong, {"ok": true} — do not invent nitpicks.`;

export async function POST(req: Request) {
  let body: { lessonMd?: unknown; messageId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: true });
  }
  const lessonMd = typeof body.lessonMd === "string" ? body.lessonMd : "";
  const messageId =
    typeof body.messageId === "string" && body.messageId.length <= 100 ? body.messageId : undefined;
  if (!lessonMd.trim() || lessonMd.length > 100_000) return NextResponse.json({ ok: true });

  const digest = parseTeachEvents(lessonMd, true)
    .map((e) =>
      e.kind === "speak" ? `SAID: ${e.text}` : `WROTE: ${JSON.stringify(e.action)}`,
    )
    .join("\n")
    .slice(0, 12_000);

  try {
    const result = await generateText({
      model: slotModel("reason"),
      system: QA_PROMPT,
      prompt: digest,
      abortSignal: AbortSignal.timeout(45_000),
    });
    const raw = result.text.match(/\{[\s\S]*\}/)?.[0];
    if (!raw) return NextResponse.json({ ok: true });
    const verdict = JSON.parse(raw) as { ok?: boolean; issue?: string; correctionMd?: string };
    let correctionMd =
      typeof verdict.correctionMd === "string"
        ? verdict.correctionMd.trim().slice(0, MAX_CORRECTION_CHARS)
        : "";
    if (verdict.ok !== false || !correctionMd) return NextResponse.json({ ok: true });

    // A correction must itself be performable teach markdown with at least
    // one speakable line; otherwise appending it would wedge the pump's tail.
    // A fence the parser can't turn into draw actions (wrong shape) is
    // stripped — a spoken-only correction still corrects.
    let events = parseTeachEvents(correctionMd, true);
    if (/```board/.test(correctionMd) && !events.some((e) => e.kind === "draw")) {
      correctionMd = correctionMd.replace(/```board[\s\S]*?```/g, "").trim();
      events = parseTeachEvents(correctionMd, true);
    }
    if (!events.some((e) => e.kind === "speak")) return NextResponse.json({ ok: true });

    if (messageId) {
      try {
        updateMessageContent(messageId, `${lessonMd}\n\n${correctionMd}`);
      } catch {
        /* stored copy stays stale; the live performance still corrects */
      }
    }
    return NextResponse.json({ ok: false, issue: verdict.issue ?? "", correctionMd });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
