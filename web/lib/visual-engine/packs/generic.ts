/**
 * Generic fallback pack — recasts the original 6 diagram types as templates.
 *
 * These are ALWAYS included in the prompt (via getTemplates), so a wrong subject route or an
 * unknown concept still produces a valid hand-drawn diagram instead of failing. Their ids match
 * `inferTemplateFromDiagramType(diagramType)` so a doc that carries only a diagramType (no
 * template) dispatches through the registry when present. Layouts reuse the existing deterministic
 * strategies unchanged — the original engine behavior is preserved exactly.
 */
import type { ConceptDoc } from "../schema";
import type { PositionedGraph } from "../layout";
import {
  layoutCircular,
  layoutComparison,
  layoutDagre,
  layoutRadial,
  layoutTimeline,
} from "../layout";
import { registerTemplate, type Template } from "../registry";

const tmpl = (t: Template): void => registerTemplate(t);

tmpl({
  id: "generic.hierarchy",
  subject: "generic",
  label: "Hierarchy / tree",
  description: "Tree, taxonomy, or component breakdown with parent→child edges.",
  promptFragment:
    "hierarchy — a tree/taxonomy: a root with parent→child edges. Use for org charts, component breakdowns, classifications.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutDagre(doc, "TB"),
});

tmpl({
  id: "generic.flow",
  subject: "generic",
  label: "Flow / pipeline",
  description: "Algorithm, process, or pipeline ordered left→right or top→bottom.",
  promptFragment:
    "flow — an algorithm/process/pipeline: ordered steps flowing left→right. Use for algorithms, pipelines, decision flows.",
  fewShot: {
    query: "Visualize: binary search on a sorted array.",
    doc: {
      title: "Binary Search",
      summary:
        "Binary search finds a target in a sorted array by repeatedly halving the search range. Compare the middle element; go left if smaller, right if larger, until found or empty.",
      diagramType: "flow",
      template: "generic.flow",
      nodes: [
        { id: "start", label: "Sorted array + target", kind: "box" },
        { id: "mid", label: "Look at middle", kind: "box" },
        { id: "cmp", label: "mid == target?", kind: "ellipse" },
        { id: "left", label: "search left half", kind: "box" },
        { id: "right", label: "search right half", kind: "box" },
        { id: "found", label: "return index", kind: "pill" },
        { id: "empty", label: "range empty -> not found", kind: "pill" },
      ],
      edges: [
        { from: "start", to: "mid" },
        { from: "mid", to: "cmp" },
        { from: "cmp", to: "found", label: "yes" },
        { from: "cmp", to: "left", label: "target smaller" },
        { from: "cmp", to: "right", label: "target larger" },
        { from: "left", to: "mid" },
        { from: "right", to: "mid" },
        { from: "mid", to: "empty", label: "range empty" },
      ],
    },
  },
  layout: (doc: ConceptDoc): PositionedGraph => layoutDagre(doc, "LR"),
});

tmpl({
  id: "generic.cycle",
  subject: "generic",
  label: "Cycle",
  description: "Cyclic process (water cycle, Krebs, state machine) — edges form a loop.",
  promptFragment:
    "cycle — a cyclic process: edges form a closed loop. Use for water cycle, Krebs cycle, state machines, feedback loops.",
  fewShot: {
    query: "Visualize: the water cycle.",
    doc: {
      title: "The Water Cycle",
      summary:
        "Water continuously moves between ground and sky: the sun evaporates water, vapor condenses into clouds, precipitation falls, and runoff returns it to oceans.",
      diagramType: "cycle",
      template: "generic.cycle",
      nodes: [
        { id: "sun", label: "Sun heats water", kind: "box" },
        { id: "evap", label: "Evaporation", kind: "box" },
        { id: "cloud", label: "Condensation -> clouds", kind: "box" },
        { id: "precip", label: "Precipitation", kind: "box" },
        { id: "ocean", label: "Collection / runoff", kind: "box" },
      ],
      edges: [
        { from: "sun", to: "evap" },
        { from: "evap", to: "cloud" },
        { from: "cloud", to: "precip" },
        { from: "precip", to: "ocean" },
        { from: "ocean", to: "sun" },
      ],
    },
  },
  layout: (doc: ConceptDoc): PositionedGraph => layoutCircular(doc),
});

tmpl({
  id: "generic.timeline",
  subject: "generic",
  label: "Timeline",
  description: "Chronological / cause-effect chain using steps[] with increasing `at`.",
  promptFragment:
    "timeline — a chronological/cause-effect chain: provide steps[] with increasing `at`. Use for history, event sequences, causes.",
  layout: (doc: ConceptDoc): PositionedGraph => layoutTimeline(doc),
});

tmpl({
  id: "generic.comparison",
  subject: "generic",
  label: "Comparison",
  description: "Side-by-side contrast (SWOT, pros/cons, A vs B) using groups for each side.",
  promptFragment:
    "comparison — side-by-side contrast: use groups[] for each side. Use for SWOT, pros/cons, A vs B.",
  layout: (doc: ConceptDoc): PositionedGraph =>
    doc.groups && doc.groups.length > 0 ? layoutComparison(doc) : layoutDagre(doc, "LR"),
});

tmpl({
  id: "generic.mindmap",
  subject: "generic",
  label: "Mind map",
  description: "Radial concept map of loosely connected ideas around a central node.",
  promptFragment:
    "mindmap — a radial concept map: a central node with loosely connected ideas. Permits lone nodes (no edges).",
  layout: (doc: ConceptDoc): PositionedGraph => layoutRadial(doc),
});