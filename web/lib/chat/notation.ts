import { generateText, type LanguageModel } from "ai";
import { validateVision, getModelConfig } from "@/lib/llm/provider";
import { loadPageImage, hasPageImages, ensurePageImages, listPageImages } from "@/lib/ingest/pdf-pages";
import { getNotationNote, saveNotationNote, materialIdsAllExist } from "@/lib/db";
import type { SourceEntry } from "@/lib/db";
import type { DiagramType } from "@/lib/chat/diagram-intent";

type ModelConfig = ReturnType<typeof getModelConfig>;

// Diagram notation cache orchestration.
//
// The vision model is expensive (per-token image payloads) and the knowledge
// it extracts — "how does THIS course draw an ER diagram" — is stable per
// (project, diagram type). So we pay the vision cost ONCE: on the first
// diagram request of a given type in a project, a short vision call reads the
// relevant slide page images and writes a reusable text note into the
// diagram_notation table. Every later diagram request of the same type reuses
// the note with the cheap text model — no vision call, no images.
//
// resolveNotation returns the note to inject into the text model's prompt, or
// null when no note is available (no vision model, no page images, backend
// unreachable) — in which case the caller falls back to the text-only Mermaid
// path.

// At most this many distinct slide pages are sent to the vision model in one
// notation-extraction call. The retrieved sources' pages are deduped; this cap
// bounds the image payload.
const MAX_PAGES = 6;

// Collect distinct (materialId, page) pairs from the retrieved sources that we
// can get rendered page images for, capped at MAX_PAGES. If a material's page
// images aren't on disk yet BUT its source PDF is retained, render them now
// (ensurePageImages) — so any material whose PDF was saved at upload "just
// works" on its first diagram turn without re-uploading. To bound work on a
// single turn, we only lazily render for the first few distinct materials.
async function collectPages(sources: SourceEntry[]): Promise<{ materialId: string; page: number }[]> {
  // Distinct material ids that appear in sources with a page, in retrieval
  // order — we'll lazily render page images for the first few that lack them.
  const materialOrder: string[] = [];
  const seenMat = new Set<string>();
  for (const s of sources) {
    if (s.page == null || seenMat.has(s.materialId)) continue;
    seenMat.add(s.materialId);
    materialOrder.push(s.materialId);
  }
  let rendersLeft = 3;
  const haveImages = new Set<string>();
  for (const mid of materialOrder) {
    if (hasPageImages(mid)) {
      haveImages.add(mid);
      continue;
    }
    if (rendersLeft <= 0) continue;
    rendersLeft--;
    // Render from the retained source PDF if available (one-time, then cached).
    if (await ensurePageImages(mid)) haveImages.add(mid);
  }
  const seen = new Set<string>();
  const out: { materialId: string; page: number }[] = [];
  for (const s of sources) {
    if (s.page == null) continue;
    if (!haveImages.has(s.materialId)) continue;
    const key = `${s.materialId}:${s.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ materialId: s.materialId, page: s.page });
    if (out.length >= MAX_PAGES) break;
  }
  if (out.length > 0) return out;

  // Fallback: no chunk had a usable page mapping. This happens for old decks
  // ingested before page boundaries were preserved (chunks are page-ambiguous).
  // For NOTATION extraction the vision model only needs to SEE how the course
  // draws diagrams — not the exact page a chunk came from — so send a
  // representative spread of the dominant retrieved material's pages. Pick the
  // material that appears most often in the sources (most likely to be on-topic)
  // and sample evenly across its rendered pages.
  const counts = new Map<string, number>();
  for (const s of sources) counts.set(s.materialId, (counts.get(s.materialId) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [mid] of ranked) {
    if (!haveImages.has(mid)) continue;
    const all = listPageImages(mid);
    if (all.length === 0) continue;
    // Evenly sample up to MAX_PAGES across the deck (incl. first + last).
    const picks = new Set<number>();
    for (let i = 0; i < all.length && picks.size < MAX_PAGES; i++) {
      const idx = Math.round((i * (all.length - 1)) / Math.max(1, MAX_PAGES - 1));
      picks.add(all[idx]);
    }
    return [...picks].sort((a, b) => a - b).map((page) => ({ materialId: mid, page }));
  }
  return [];
}

// The vision model's only job: read the attached slide pages and write a
// compact, self-contained notation spec the text model can follow later
// WITHOUT seeing any images. Output is the note itself — nothing else.
function extractionSystemPrompt(diagramType: DiagramType): string {
  const typeName: Record<DiagramType, string> = {
    er: "entity-relationship (ER) model",
    flowchart: "flowchart",
    sequence: "sequence diagram",
    class: "class diagram",
    state: "state diagram",
    graph: "precedence / conflict graph",
    generic: "diagram",
  };
  return `You are reading pages from a university course's slide deck. The course draws ${typeName[diagramType]}s in a specific notation — its own shapes, symbols, line styles, cardinality markers, layout conventions, and labeling style. Study the attached slide images carefully, then write a COMPACT, SELF-CONTAINED text specification of exactly how this course draws a ${typeName[diagramType]}.

Your output will be reused by a text-only model (which cannot see the images) to draw future ${typeName[diagramType]}s in this exact style. So the specification must be complete enough to reproduce the notation from text alone.

Cover, as applicable to this diagram type:
- The shape used for each element (entity, relationship, attribute, state, class, process step, etc.) — e.g. rectangle, diamond, oval, rounded box, circle.
- Line styles for connections (solid, dashed, directed arrows, double lines) and what each means.
- How cardinalities / multiplicities / labels are written and where they sit on the edges (e.g. "1", "N", "M" on the line, crow's-foot at the end, (min,max) in parentheses).
- How primary keys / identifiers are marked (underline, bold, "PK", a key icon).
- Layout conventions (top-down, left-right, hub-and-spoke) and any grouping (e.g. weak entities, inheritance arrows).
- Any other visual convention the slides consistently use.

Rules:
- Output ONLY the notation specification — plain prose + a short bullet list. No preamble, no "here is...", no diagram of your own, no code fences.
- Be precise and concrete about the SHAPES and MARKERS — that is what the text model needs. Do not just say "standard notation"; say exactly which notation (e.g. "Chen-style ER: entities are rectangles, relationships are diamonds, attributes are ovals, PKs underlined, cardinalities written as 1/N/M on the edge near the relationship").
- Keep it under ~250 words. If the slides do not clearly show a particular aspect, say so briefly rather than inventing a convention.`;
}

// Optional callback the caller wires to its SSE status emitter, so the
// notation pipeline reports its own granular phases ("recalling your course's
// notation…", "studying how your course draws diagrams…") through the SAME
// generic dynamic-status channel every other pipeline stage uses — no
// special-cased status code path in the chat route.
export type NotationStatusFn = (phase: string, label?: string) => void;

export async function resolveNotation(args: {
  projectId: string;
  diagramType: DiagramType;
  cfg: ModelConfig;
  visionModel: LanguageModel | null;
  sources: SourceEntry[];
  abortSignal: AbortSignal;
  onStatus?: NotationStatusFn;
}): Promise<{ note: string; materialIds: string[] } | null> {
  const { projectId, diagramType, cfg, visionModel, sources, abortSignal, onStatus } = args;

  // 1. Cached + still valid? (material_ids all still present in the project.)
  const cached = getNotationNote(projectId, diagramType);
  if (cached && materialIdsAllExist(projectId, cached.materialIds)) {
    // Cache hit → no vision call. Tell the UI we're reusing the learned
    // notation, then the (cheap) text model takes over to draw the diagram.
    onStatus?.("recalling-notation", "recalling your course's notation…");
    return { note: cached.note, materialIds: cached.materialIds };
  }

  // 2. No cache → need the vision model + page images to extract a note.
  if (!visionModel) return null;
  // Page collection may lazily render slide images from the retained PDF —
  // surface that as "looking at your slides" before the slower vision call.
  onStatus?.("notation-reading-slides", "looking at your slides…");
  const pages = await collectPages(sources);
  if (pages.length === 0) return null;
  try {
    await validateVision(cfg);
  } catch {
    return null; // unreachable / bad key → degrade to text-only Mermaid.
  }
  // About to send the slide images to the vision model and have it study the
  // course's diagram notation — this is the slow, one-time-per-(project,type)
  // step, so give it its own phase the UI can show for the duration.
  onStatus?.("studying-notation", "studying how your course draws diagrams…");
  const bufs = pages
    .map(({ materialId, page }) => loadPageImage(materialId, page))
    .filter((b): b is Buffer => b !== null);
  if (bufs.length === 0) return null;

  const imageParts = bufs.map((b) => ({
    type: "image" as const,
    image: `data:image/jpeg;base64,${b.toString("base64")}`,
  }));
  const materialIds = Array.from(new Set(pages.map((p) => p.materialId)));

  try {
    const { text } = await generateText({
      model: visionModel,
      system: extractionSystemPrompt(diagramType),
      messages: [
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: "Attached are slide pages from this course. Write the notation specification as instructed." },
            ...imageParts,
          ],
        },
      ],
      maxOutputTokens: 1024,
      abortSignal,
    });
    const note = text.trim();
    if (!note) return null;
    // Persist for reuse on every future {diagramType} request in this project.
    saveNotationNote(projectId, diagramType, note, materialIds);
    // Notation learned + cached — the text model will now draw the diagram
    // from it. A brief phase here hands the baton to the streaming draw step.
    onStatus?.("notation-ready", "notation learned — drawing the diagram…");
    return { note, materialIds };
  } catch {
    return null; // vision call failed → degrade to text-only Mermaid.
  }
}

// The block injected into the text model's system prompt when a notation note
// is available, so it reproduces the course's exact notation when drawing.
const TYPE_LABEL: Record<DiagramType, string> = {
  er: "entity-relationship (ER) model",
  flowchart: "flowchart",
  sequence: "sequence diagram",
  class: "class diagram",
  state: "state diagram",
  graph: "precedence / conflict graph",
  generic: "diagram",
};

export function notationSystemBlock(note: string, diagramType: DiagramType): string {
  return `\n\nCourse diagram notation — this project's ${TYPE_LABEL[diagramType]} is drawn in this exact style. Reproduce it FAITHFULLY; do NOT substitute a different (e.g. generic crow's-foot) notation:
${note}

Rendering — choose the path that can FAITHFULLY express this notation:
- Emit a single \`mermaid\` fenced block IF Mermaid has a native type that can reproduce this notation exactly (use \`erDiagram\` for crow's-foot ER, \`flowchart\` for flowcharts and directed node-edge graphs, \`sequenceDiagram\`, \`classDiagram\`, \`stateDiagram-v2\`).
- Otherwise emit a single \`artifact\` fenced block with kind \`"figure"\` — a native data-only vector DSL the platform renders to inline SVG. Use it for Chen-style ER (rectangles for entities, diamonds for relationships, ovals for attributes, labelled cardinalities on the edges), directed transaction graphs (precedence / conflict / wait-for), and any notation Mermaid's named types cannot express. The \`figure\` data shape is:
  {"width":number,"height":number,"shapes":[{"id":string,"type":"rect"|"rounded"|"diamond"|"oval"|"circle","x":number,"y":number,"w":number,"h":number,"label":string,"kind":"entity"|"relationship"|"attribute"|"state"|"process"|"class"|"note"}],"connectors":[{"id":string,"from":string,"to":string,"style":"solid"|"dashed"|"double","arrow":"none"|"forward"|"both","label":string,"cardinality":string}],"legend":[{"label":string,"swatch":"solid"|"dashed"|"diamond"|"rect"|"oval"}]}
  You choose the coordinates (x, y, w, h) to lay the diagram out in this notation's style; the platform owns stroke, color, and font. Use \`kind\` on each shape to tag its role (entity/relationship/attribute/…) so the platform colors it correctly. Add a \`legend\` when the notation uses markers a reader needs explained.
- Never put HTML, CSS, JS, arbitrary SVG, or URLs inside a native \`artifact\` envelope. The \`figure\` DSL is a constrained shape vocabulary, not raw SVG.
- This override takes precedence over any general "use mermaid for diagrams" instruction.`;
}