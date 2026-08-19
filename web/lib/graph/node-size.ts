// Single source of truth for concept-node box dimensions. Pure, no React, no
// DB, no layout library. Used by the Cytoscape element builder (node data
// width/height) so the box Cytoscape lays out is exactly the box the user
// sees — edges attach to the right rect and labels wrap inside it.
//
// Typography constants MUST match the Cytoscape node style in graph-tokens.ts
// (mono via the resolved `--font-mono` stack, font-size 12px, border-box sizing,
// border 2px). Tailwind preflight sets `box-sizing: border-box`, so a declared
// width INCLUDES padding + border — the measurement below accounts for that.

const CHAR_ADVANCE = 7.4; // px per mono char at 12px (incl. letter-spacing)
const LINE_HEIGHT = 16; // px per wrapped line
const MAX_WIDTH = 220; // px cap (~27 mono chars); matches the overview card min width
const PAD_X = 8; // px-2 each side
const PAD_Y = 4; // py-1 each side
const BORDER = 2; // border-2 each side

// Horizontal overhead added on top of the raw text width: padding both sides
// + border both sides. Because of border-box, this is the only horizontal
// addition — declared width = textWidth + H_OVERHEAD.
const H_OVERHEAD = PAD_X * 2 + BORDER * 2; // 20
// Vertical overhead on top of the wrapped line block: padding + border, both
// sides. Declared height = lines * LINE_HEIGHT + V_OVERHEAD.
const V_OVERHEAD = PAD_Y * 2 + BORDER * 2; // 12

export const NODE_BORDER = BORDER;
export const NODE_TEXT_OVERHEAD = H_OVERHEAD; // exposed so callers can derive text-max-width

// Greedy word-wrap on spaces. A single token longer than the cap is broken at
// the cap (the rendered node also uses Cytoscape `text-wrap: wrap` as a CSS
// fallback; the measurer must agree so edges attach to the actual box).
function wrapLabel(label: string, maxChars: number): string[] {
  const words = label.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let cur = "";
  const pushToken = (token: string) => {
    // A token longer than the cap is broken into cap-sized chunks; the first
    // chunk shares a line with `cur` if there's room, later chunks start
    // their own lines.
    let rest = token;
    while (rest.length > maxChars) {
      if (cur.length === 0) {
        lines.push(rest.slice(0, maxChars));
        rest = rest.slice(maxChars);
      } else if (cur.length + 1 >= maxChars) {
        lines.push(cur);
        cur = "";
      } else {
        const room = maxChars - cur.length - 1; // -1 for the joining space
        lines.push(cur + " " + rest.slice(0, room));
        cur = "";
        rest = rest.slice(room);
      }
    }
    if (rest.length === 0) return;
    if (cur.length === 0) {
      cur = rest;
    } else if (cur.length + 1 + rest.length <= maxChars) {
      cur = cur + " " + rest;
    } else {
      lines.push(cur);
      cur = rest;
    }
  };
  for (const word of words) pushToken(word);
  if (cur.length > 0) lines.push(cur);
  return lines.length > 0 ? lines : [""];
}

// Returns { width, height } in px for a concept node rendering `label`.
export function measureConceptNode(label: string): { width: number; height: number } {
  const maxChars = Math.floor((MAX_WIDTH - H_OVERHEAD) / CHAR_ADVANCE);
  const lines = wrapLabel(label, Math.max(1, maxChars));
  let textWidth = 0;
  for (const line of lines) {
    const w = line.length * CHAR_ADVANCE;
    if (w > textWidth) textWidth = w;
  }
  const width = Math.min(MAX_WIDTH, Math.ceil(textWidth + H_OVERHEAD));
  const height = lines.length * LINE_HEIGHT + V_OVERHEAD;
  return { width, height };
}