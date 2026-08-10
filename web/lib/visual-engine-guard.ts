import type { PositionedGraph } from "@/lib/visual-engine/index";

// A geometry check on the engine's output.
//
// Deliberately NOT the vision repair loop used for mathwriter diagrams
// (teacher/app/performance/render_qa.py). That loop exists because the
// handwriting engine's composition failures are only visible in pixels: a
// label struck through by its own ellipse, a table sheared off. Here the model
// never emits a coordinate — every position is computed by deterministic
// layout code — so "do two boxes overlap" is arithmetic we already have, and
// asking a vision model instead would cost two round trips to re-derive it
// less reliably.
//
// This is a runtime guard rather than only a test because the engine's own
// tests cover the templates its authors wrote; a lesson can hand it a graph
// shape nobody anticipated, and silently drawing two boxes on top of each
// other is exactly the class of bug we are trying to leave behind.

export interface LayoutProblem {
  kind: "overlap" | "out-of-bounds" | "empty" | "dangling-edge" | "degenerate";
  detail: string;
}

// Nodes are drawn as sketched outlines whose stroke wanders a few px outside
// the box, so touching edges are fine and a small tolerance avoids flagging
// layouts that read perfectly.
const OVERLAP_TOLERANCE = 4;

function rect(node: { x: number; y: number; w: number; h: number }) {
  return {
    left: node.x - node.w / 2,
    right: node.x + node.w / 2,
    top: node.y - node.h / 2,
    bottom: node.y + node.h / 2,
  };
}

function overlapArea(
  a: ReturnType<typeof rect>,
  b: ReturnType<typeof rect>,
): number {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > OVERLAP_TOLERANCE && height > OVERLAP_TOLERANCE ? width * height : 0;
}

export function checkLayout(graph: PositionedGraph): LayoutProblem[] {
  const problems: LayoutProblem[] = [];

  if (!graph.nodes?.length) {
    problems.push({ kind: "empty", detail: "layout produced no nodes" });
    return problems;
  }
  if (!(graph.width > 0) || !(graph.height > 0)) {
    problems.push({
      kind: "degenerate",
      detail: `canvas is ${graph.width}x${graph.height}`,
    });
  }

  const ids = new Set(graph.nodes.map((node) => node.id));
  for (const edge of graph.edges ?? []) {
    for (const end of [edge.from, edge.to]) {
      if (!ids.has(end)) {
        problems.push({
          kind: "dangling-edge",
          detail: `edge ${edge.from}->${edge.to} references unknown node "${end}"`,
        });
      }
    }
  }

  for (const node of graph.nodes) {
    const box = rect(node);
    if (box.left < -OVERLAP_TOLERANCE || box.top < -OVERLAP_TOLERANCE) {
      problems.push({
        kind: "out-of-bounds",
        detail: `"${node.label}" starts off-canvas at (${Math.round(box.left)}, ${Math.round(box.top)})`,
      });
    }
    if (box.right > graph.width + OVERLAP_TOLERANCE || box.bottom > graph.height + OVERLAP_TOLERANCE) {
      problems.push({
        kind: "out-of-bounds",
        detail: `"${node.label}" extends past the canvas to (${Math.round(box.right)}, ${Math.round(box.bottom)})`,
      });
    }
  }

  for (let i = 0; i < graph.nodes.length; i++) {
    for (let j = i + 1; j < graph.nodes.length; j++) {
      const a = graph.nodes[i]!;
      const b = graph.nodes[j]!;
      if (overlapArea(rect(a), rect(b)) > 0) {
        problems.push({
          kind: "overlap",
          detail: `"${a.label}" overlaps "${b.label}"`,
        });
      }
    }
  }

  return problems;
}
