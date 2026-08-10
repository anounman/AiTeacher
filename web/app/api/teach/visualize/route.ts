import { NextResponse } from "next/server";
import { updateMessageContent } from "@/lib/db";
import { planLessonVisuals } from "@/lib/teach/visual-director";
import {
  appendConceptGraph,
  appendVisualPlan,
  lessonTopic,
  visualInputFromLesson,
} from "@/lib/teach/visual-lesson";
import { visualizeConcept } from "@/lib/visual-engine-server";
import { checkLayout } from "@/lib/visual-engine-guard";

type Body = { lessonMd?: unknown; lessonId?: unknown; messageId?: unknown };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const lessonMd = typeof body.lessonMd === "string" ? body.lessonMd : "";
  if (!lessonMd.trim() || lessonMd.length > 120_000) {
    return NextResponse.json({ error: "lessonMd is required and must be under 120 KB" }, { status: 400 });
  }
  const lessonId = typeof body.lessonId === "string" ? body.lessonId : undefined;
  const messageId = typeof body.messageId === "string" && body.messageId.length <= 100
    ? body.messageId
    : undefined;

  // The visual engine (lib/visual-engine) replaces the director for lesson
  // diagrams when VISUAL_ENGINE=1. It is a better fit by construction: the
  // model emits a semantic graph with no coordinates and deterministic code
  // does the layout, so the overlap failures the director produced cannot
  // occur. Flag-gated and falling through on any failure, because a lesson
  // that already played is not worth breaking for a nicer picture.
  if (process.env.VISUAL_ENGINE === "1") {
    const topic = lessonTopic(lessonMd);
    if (topic) {
      try {
        const { doc, graph } = await visualizeConcept(topic, { timeoutMs: 30_000 });
        const layoutProblems = checkLayout(graph);
        // A diagram that fails geometry is worse than the hand-drawn board
        // items the lesson already has, so fall through to the director
        // rather than putting overlapping boxes in front of a student.
        if (layoutProblems.length) {
          console.warn("[teach/visualize] engine layout rejected:", layoutProblems);
          throw new Error(layoutProblems.map((p) => p.detail).join("; "));
        }
        const directed = appendConceptGraph(lessonMd, graph, {
          title: doc.title,
          summary: doc.summary,
        });
        if (messageId) updateMessageContent(messageId, directed);
        return NextResponse.json({
          source: "engine",
          engine: { diagramType: doc.diagramType, template: doc.template ?? null, topic },
          directedMd: directed,
        });
      } catch (err) {
        console.warn("[teach/visualize] engine failed, using director:", err);
      }
    }
  }

  // This route never gates lesson playback, and a scene that lands after the
  // lesson has finished is worthless — so cap the wait well inside a typical
  // lesson rather than letting a thinking model run for minutes. On timeout
  // planLessonVisuals returns its deterministic, fact-preserving scene.
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(20_000)]);
  const input = visualInputFromLesson(lessonMd, lessonId);
  const result = await planLessonVisuals(input, { abortSignal: signal });
  // Only a real model plan is worth keeping. The deterministic fallback just
  // restates board elements the lesson already drew by hand, so persisting it
  // would replay a redundant card on every future reload of this lesson.
  const directedMd = result.source === "model" ? appendVisualPlan(lessonMd, result.plan) : lessonMd;
  if (messageId && result.source === "model") updateMessageContent(messageId, directedMd);

  return NextResponse.json({
    plan: result.plan,
    source: result.source,
    issues: result.issues,
    directedMd,
  });
}
