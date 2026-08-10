import { parseTeachEvents, speakable, type TeachAction, type TeachEvent } from "./protocol";
import { visualPlanSchema, type VisualPlan, type VisualPlanningInput } from "./visual-schema";

function stableId(raw: string | undefined, fallback: string): string {
  if (raw && /^[A-Za-z][A-Za-z0-9._:-]*$/.test(raw)) return raw;
  if (raw) {
    const cleaned = raw.replace(/[^A-Za-z0-9._:-]+/g, "-").slice(0, 72);
    if (cleaned) return /^[A-Za-z]/.test(cleaned) ? cleaned : `id-${cleaned}`;
  }
  return fallback;
}

function readableMarkup(markup: string): string {
  return markup
    // Diagram blocks are pixel programs, not prose — echoing them verbatim
    // into the visual director's input made it emit nodes labeled with raw
    // "[DRAW] CIRCLE 200,12 …" that then rendered on the board.
    .replace(/\[DRAW\][\s\S]*?\[\/DRAW\]/g, "(hand-drawn diagram)")
    .replace(/\[G\][\s\S]*?\[\/G\]/g, "(hand-drawn diagram)")
    .replace(/~~/g, "")
    .replace(/\[(?:F|R|S|I|M|B|X|T|U|D|V|H)\]/g, "")
    .replace(/\[\/(?:F|R|S|I|M|B|X|T|U|D|V|H)\]/g, "")
    .replace(/\|/g, " over ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function boardElement(action: TeachAction, eventIndex: number): VisualPlanningInput["boardElements"][number] | null {
  const fallback = `board-${eventIndex + 1}`;
  switch (action.type) {
    case "write":
      return { id: stableId(action.id, fallback), label: readableMarkup(action.markup) || "Board note", kind: "concept" };
    case "heading":
      return { id: stableId(action.id, fallback), label: action.text.slice(0, 180), kind: "text" };
    case "text":
      return { id: stableId(action.id, fallback), label: action.text.slice(0, 180), kind: "text" };
    case "latex":
      return { id: stableId(action.id, fallback), label: action.tex.slice(0, 180), kind: "equation" };
    case "code":
      return { id: stableId(action.id, fallback), label: `${action.lang ?? "code"}: ${action.code.split("\n")[0]}`.slice(0, 180), kind: "code" };
    default:
      return null;
  }
}

/** Build fact-preserving, stable IDs from the exact event stream the player uses. */
export function visualInputFromLesson(
  lessonMd: string,
  lessonId?: string,
): VisualPlanningInput {
  const events = parseTeachEvents(lessonMd, true);
  const segments: VisualPlanningInput["segments"] = [];
  const boardElements: VisualPlanningInput["boardElements"] = [];
  const relationships: VisualPlanningInput["relationships"] = [];
  const elementByEvent = new Map<number, string>();

  events.forEach((event, eventIndex) => {
    if (event.kind === "speak") {
      segments.push({
        id: `segment-${segments.length + 1}`,
        text: speakable(event.text).slice(0, 1200),
        boardElementIds: [],
      });
      return;
    }
    const element = boardElement(event.action, eventIndex);
    if (!element || boardElements.some((known) => known.id === element.id)) return;
    boardElements.push(element);
    elementByEvent.set(eventIndex, element.id);
  });

  // Match the performer's beat rule (speech run followed by draw run). The
  // last spoken segment owns the visual cue; sequential board steps are an
  // explicit flow present in the lesson order, not a newly invented fact.
  let cursor = 0;
  let segmentCursor = 0;
  while (cursor < events.length) {
    const spokenSegments: number[] = [];
    const drawIds: string[] = [];
    while (cursor < events.length && events[cursor]!.kind === "speak") {
      spokenSegments.push(segmentCursor++);
      cursor++;
    }
    while (cursor < events.length && events[cursor]!.kind === "draw") {
      const id = elementByEvent.get(cursor);
      if (id) drawIds.push(id);
      const action = (events[cursor] as Extract<TeachEvent, { kind: "draw" }>).action;
      if (action.type === "arrow") {
        relationships.push({
          from: stableId(action.from, action.from),
          to: stableId(action.to, action.to),
          ...(action.label ? { label: action.label.slice(0, 80) } : {}),
          relationship: "flow",
        });
      }
      cursor++;
    }
    const owner = spokenSegments.at(-1);
    if (owner !== undefined && segments[owner]) segments[owner].boardElementIds = drawIds;
    for (let i = 1; i < drawIds.length; i++) {
      relationships.push({ from: drawIds[i - 1]!, to: drawIds[i]!, relationship: "flow" });
    }
    if (!spokenSegments.length && !drawIds.length) cursor++;
  }

  const heading = boardElements.find((element) => element.kind === "text")?.label;
  const firstSpeech = segments[0]?.text || "Lesson visual map";
  const topic = (heading || firstSpeech).slice(0, 160);
  return {
    ...(lessonId ? { lessonId: stableId(lessonId, "lesson") } : {}),
    topic,
    objective: firstSpeech.slice(0, 320),
    segments,
    boardElements,
    relationships,
    assetCatalog: [],
  };
}

export function appendVisualPlan(lessonMd: string, plan: VisualPlan): string {
  const validated = visualPlanSchema.parse(plan);
  const alreadyPresent = parseTeachEvents(lessonMd, true).some(
    (event) => event.kind === "draw" && event.action.type === "visual_scene" && event.action.plan.sceneId === validated.sceneId,
  );
  if (alreadyPresent) return lessonMd;
  const fence = `\`\`\`board\n${JSON.stringify([{ type: "visual_scene", plan: validated }], null, 2)}\n\`\`\``;
  return `${lessonMd.trimEnd()}\n\n${fence}`;
}

export function segmentEventIndex(events: TeachEvent[], segmentId: string | undefined): number | null {
  const match = /^segment-(\d+)$/.exec(segmentId ?? "");
  if (!match) return null;
  const target = Number(match[1]);
  let seen = 0;
  for (let index = 0; index < events.length; index++) {
    if (events[index]!.kind !== "speak") continue;
    seen++;
    if (seen === target) return index;
  }
  return null;
}
