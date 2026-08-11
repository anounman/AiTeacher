import { NextResponse } from "next/server";
import { visualizeConcept } from "@/lib/visual-engine-server";
import { checkLayout } from "@/lib/visual-engine-guard";

// Draw one board diagram with the visual engine.
//
// Same engine as /api/visualize, but this is the in-lesson path: the teacher
// asks for a diagram of a concept mid-explanation, rather than a whole page
// being visualised afterwards.
//
// A layout that fails the geometry guard is refused rather than drawn. The
// board's fallback for a missing diagram is the spoken explanation, which is
// better than overlapping boxes in front of a student.
export async function POST(req: Request) {
  let body: { concept?: unknown };
  try {
    body = (await req.json()) as { concept?: unknown };
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const concept = typeof body.concept === "string" ? body.concept.trim().slice(0, 200) : "";
  if (concept.length < 3) {
    return NextResponse.json({ error: "concept required" }, { status: 400 });
  }

  try {
    const { doc, graph } = await visualizeConcept(concept, { timeoutMs: 40_000 });
    const problems = checkLayout(graph);
    if (problems.length) {
      console.warn("[teach/diagram] layout rejected:", concept, problems);
      return NextResponse.json(
        { error: "layout failed", problems: problems.map((p) => p.detail) },
        { status: 422 },
      );
    }
    return NextResponse.json({
      graph,
      title: doc.title,
      diagramType: doc.diagramType,
      template: doc.template ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "diagram failed" },
      { status: 502 },
    );
  }
}
