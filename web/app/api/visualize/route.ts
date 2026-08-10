import { NextResponse } from "next/server";
import { visualizeConcept, visualSlotModel } from "@/lib/visual-engine-server";
import { checkLayout } from "@/lib/visual-engine-guard";

// POST { query, courseHint? } -> { doc, graph, meta }
//
// Stage 1 (decompose) and Stage 2 (layout) run here; Stage 3 (render) runs in
// the browser, because rough.js draws into a real <svg>. That split is the
// engine's own design, not something imposed on it.
//
// Deliberately not SSE yet. The engine streams tokens internally so its abort
// budget works, but the caller only wants the finished graph — a token stream
// would be UI theatre for a payload that is useless until it validates.
export async function POST(req: Request) {
  let body: { query?: unknown; courseHint?: unknown };
  try {
    body = (await req.json()) as { query?: unknown; courseHint?: unknown };
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) return NextResponse.json({ error: "query required" }, { status: 400 });
  const courseHint = typeof body.courseHint === "string" ? body.courseHint : undefined;

  try {
    const { doc, graph, produce } = await visualizeConcept(query, { courseHint });
    return NextResponse.json({
      doc,
      graph,
      meta: {
        model: visualSlotModel(),
        // The engine reports how it got here: which attempt validated, whether
        // it had to reroute, whether it fell back. Surfaced rather than hidden,
        // because "the diagram is generic" and "the model failed twice and we
        // fell back" look identical on screen.
        attempts: produce.attempts,
        repaired: produce.repaired,
        fellBack: produce.fellBack,
        truncated: produce.truncated,
        diagramType: doc.diagramType,
        template: doc.template ?? null,
        // Geometry, not a vision model: the layout is deterministic code, so
        // overlap is arithmetic we already have. See lib/visual-engine-guard.
        layoutProblems: checkLayout(graph),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "visualize failed" },
      { status: 502 },
    );
  }
}
