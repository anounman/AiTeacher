// Spatial registry of everything on the whiteboard. Components register each
// rendered element (equation, \cssId part, character token, handwritten text
// line, mark label) under a unique id with its live DOM element. Queries
// measure viewport rects at query time (never cached — scroll/reflow safe),
// build a BVH, and resolve a region to ranked, human/model-readable hits.

import { BVH, type BBox, type BVHLeaf } from "./bvh";

export type SpatialKind =
  | "equation"
  | "part"
  | "token"
  | "word"
  | "textline"
  | "codeline"
  | "label"
  | "heading"
  | "ink";

export interface SpatialEntry {
  id: string; // unique on the board, e.g. "eq1", "eq1#disc", "eq1/t12", "a3/l0"
  kind: SpatialKind;
  itemKey: string; // owning board item
  el: Element;
  tex?: string; // owning equation's LaTeX (equations, parts, tokens)
  text?: string; // text lines / labels / headings
}

const entries = new Map<string, SpatialEntry>();

// Idempotent — re-registration (StrictMode, live→history re-render) replaces
// the element reference with the freshest one.
export function register(entry: SpatialEntry): void {
  entries.set(entry.id, entry);
}

export function unregister(id: string): void {
  entries.delete(id);
}

export function clearBoard(): void {
  entries.clear();
}

// Board markup → something readable in a prompt: drop the tag syntax, keep
// the content ("[F]a|b[/F]" → "a|b", "~~Title~~" → "Title").
function plain(s: string | undefined): string {
  if (!s) return "";
  return s
    .replace(/~~/g, "")
    .replace(/\[\/?[A-Z]\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

const KIND_RANK: Record<SpatialKind, number> = {
  part: 0,
  word: 1,
  token: 2,
  codeline: 3,
  ink: 4,
  equation: 5,
  textline: 6,
  heading: 7,
  label: 8,
};

// Region in viewport coordinates → ranked hits.
export function queryRegion(rect: BBox): SpatialEntry[] {
  const leaves: BVHLeaf<SpatialEntry>[] = [];
  for (const e of entries.values()) {
    if (!e.el.isConnected) continue;
    const r = e.el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    leaves.push({ box: { x: r.left, y: r.top, w: r.width, h: r.height }, data: e });
  }
  const hits = new BVH(leaves).queryRect(rect);
  return hits.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
}

// Model-readable description of a selection. Tokens are only reported when no
// enclosing part was hit (they carry position, not content).
export function describeHits(hits: SpatialEntry[], max = 5): string | null {
  if (!hits.length) return null;
  const hasPart = hits.some((h) => h.kind === "part");
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    if (parts.length >= max) break;
    if (h.kind === "token" && hasPart) continue;
    if (h.kind === "word" && hasPart) continue;
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    switch (h.kind) {
      case "part": {
        const [eq, part] = h.id.split("#");
        parts.push(`part "${part}" of ${eq}${h.tex ? ` (which reads: ${plain(h.tex)})` : ""}`);
        break;
      }
      case "equation":
        parts.push(`board item ${h.id}${h.tex ? ` (which reads: ${plain(h.tex)})` : ""}`);
        break;
      case "token":
        parts.push(`a symbol inside ${h.id.split("/")[0]}${h.tex ? ` (which reads: ${plain(h.tex)})` : ""}`);
        break;
      case "word":
        parts.push(`the word "${plain(h.text)}" in ${h.id.split(":")[0]}`);
        break;
      case "ink":
        parts.push(`the student's own pen drawing (${plain(h.text) || "freehand ink"})`);
        break;
      case "codeline":
        parts.push(`code line ${h.id} ("${plain(h.text)}")`);
        break;
      case "textline":
      case "heading":
        parts.push(`the ${h.kind === "heading" ? "heading" : "line"} "${plain(h.text)}"`);
        break;
      case "label":
        parts.push(`the annotation label "${plain(h.text)}"`);
        break;
    }
  }
  return parts.length ? parts.join("; ") : null;
}
