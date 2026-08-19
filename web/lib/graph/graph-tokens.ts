// Graph token resolution + Cytoscape stylesheet builder.
//
// Cytoscape renders to a <canvas>, so its style objects need CONCRETE color
// strings — CSS `var(--ink-2)` does not resolve on a canvas the way it did on
// @xyflow's DOM nodes. `readGraphTokens()` resolves the graph tokens
// (and the mono font stack) from the live computed style on <html>, so the
// CSS in globals.css stays the single source of truth. The component rebuilds
// the stylesheet via `buildCytoscapeStyle(tokens)` whenever the theme flips
// (MutationObserver on html[data-theme]) — colors update without re-laying-out.
//
// `buildCytoscapeStyle` is a pure function of the resolved tokens. String
// mappers (`data(width)`, `data(op)`, …) are used for data-driven values; the
// whole array is cast to Cytoscape's stylesheet type once at the return, since
// some numeric-only style fields (opacity) accept a string mapper at runtime
// but not in the strict type.

import type { StylesheetJson } from "cytoscape";

export interface GraphTokens {
  paper: string; // unfilled node background
  paper2: string; // canvas / filled-node label background
  ink: string; // filled node background
  ink2: string; // secondary text, hierarchical edges
  ink3: string; // faint captions, peer edges, untested/unknown border
  rule: string; // red notebook rule, selection
  feynman: string; // emerald, strong band
  line: string; // hairlines
  mono: string; // resolved mono font stack for canvas text
  amber: string; // learning band border
  rose: string; // slipping band border
}

function readVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Resolve the graph tokens from the live <html> computed style. Called
// on mount and whenever html[data-theme] changes.
export function readGraphTokens(): GraphTokens {
  return {
    paper: readVar("--paper", "#ffffff"),
    paper2: readVar("--paper-2", "#f6f6f7"),
    ink: readVar("--ink", "#18181b"),
    ink2: readVar("--ink-2", "#52525b"),
    ink3: readVar("--ink-3", "#8a8a93"),
    rule: readVar("--rule", "#f97316"),
    feynman: readVar("--feynman", "#0f9d76"),
    line: readVar("--line", "#e6e6e9"),
    mono: readVar("--font-mono", "ui-monospace, monospace"),
    amber: readVar("--amber", "#c08a00"),
    rose: readVar("--rose", "#c0445a"),
  };
}

// A stylesheet block with a loose style shape (string mappers are values here,
// narrowed to Cytoscape's strict type once at the build return). `data(...)` /
// `mapData(...)` string mappers are fully supported by Cytoscape at runtime.
type StyleBlock = { selector: string; style: Record<string, string | number> };

// Build the monochrome, band-aware Cytoscape stylesheet from resolved tokens.
// Encodes mastery band borders (strong=feynman, learning=amber, slipping=rose,
// untested/unknown=ink-3), filled-vs-unfilled nodes (sourceCount>=2), the
// hierarchical-vs-peer edge split, dashed sem-sim edges, and hover/selection
// emphasis. Per-element `classes` set at build time drive the selectors here.
export function buildCytoscapeStyle(t: GraphTokens): StylesheetJson {
  const blocks: StyleBlock[] = [
    // --- Nodes: base ------------------------------------------------------
    {
      selector: "node",
      style: {
        shape: "round-rectangle",
        width: "data(width)",
        height: "data(height)",
        "background-color": t.paper, // default (unfilled)
        "border-width": 2,
        "border-color": t.ink3, // default; overridden per band
        label: "data(label)",
        "text-valign": "center",
        "text-halign": "center",
        "text-wrap": "wrap",
        "text-max-width": "data(textMax)",
        color: t.ink3, // default label color (unfilled)
        "font-family": t.mono,
        "font-size": 12,
        "font-weight": "normal",
      },
    },
    // Filled node (>=2 sources): ink background, paper label.
    { selector: "node.filled", style: { "background-color": t.ink, color: t.paper2 } },
    // Mastery band borders.
    { selector: "node.band-strong", style: { "border-color": t.feynman } },
    { selector: "node.band-learning", style: { "border-color": t.amber } },
    { selector: "node.band-slipping", style: { "border-color": t.rose } },
    { selector: "node.band-untested", style: { "border-color": t.ink3 } },
    { selector: "node.band-unknown", style: { "border-color": t.ink3, opacity: 0.45 } },
    // --- Learning-path status (applied in-place via class toggles) ----------
    // Path mode only. Status overrides band border. Order: after band, before
    // selected/hovered so selection still wins; dimmed (hover) is later still.
    // ready: accent rule border, thicker, raised — the "this is next" signal.
    { selector: "node.status-ready", style: { "border-color": t.rule, "border-width": 3, "z-index": 50 } },
    // locked: dashed faint border, muted — prereqs not met.
    { selector: "node.status-locked", style: { "border-color": t.ink3, "border-style": "dashed", opacity: 0.4 } },
    // mastered: strong feynman border, thicker — "done".
    { selector: "node.status-mastered", style: { "border-color": t.feynman, "border-width": 3 } },
    // (in_progress has no status class — the existing learning/slipping band
    //  border already signals "active".)
    // Selection + hover emphasis (rule border, thicker).
    {
      selector: "node:selected, node.hovered",
      style: { "border-color": t.rule, "border-width": 3, "z-index": 99 },
    },
    // Hover-dim: non-neighbors fade.
    { selector: "node.dimmed", style: { opacity: 0.2 } },

    // --- Edges: base ------------------------------------------------------
    {
      selector: "edge",
      style: {
        "curve-style": "bezier",
        "line-color": t.ink3,
        width: 1.2,
        "line-opacity": "data(op)",
        "target-arrow-color": t.ink3,
        "target-arrow-shape": "none",
        "arrow-scale": 1,
        "loop-direction": "-90deg",
      },
    },
    // Hierarchical edges: straight, ink-2, arrowed, full opacity weight.
    {
      selector: "edge.hierarchical",
      style: {
        "curve-style": "straight",
        "line-color": t.ink2,
        width: 1.5,
        "target-arrow-shape": "triangle",
        "target-arrow-color": t.ink2,
      },
    },
    // --- Learning-path edge emphasis (path mode only) ----------------------
    // Backbone: prerequisite_of edges read through (strong, opaque). Applied
    // to hierarchical edges in path mode via a `path-backbone` class.
    { selector: "edge.path-backbone", style: { width: 2.2, "line-color": t.ink, "line-opacity": 1, "target-arrow-color": t.ink } },
    // Peer edges fade further in path mode so the DAG reads through.
    { selector: "edge.path-faded", style: { "line-opacity": 0.12 } },
    // semantically_similar_to: dashed.
    { selector: "edge.sem-sim", style: { "line-style": "dashed" } },
    // Edge hover: reveal the relation label in a small mono tag.
    {
      selector: "edge.hovered",
      style: {
        label: "data(relation)",
        "font-size": 10,
        color: t.ink2,
        "text-background-color": t.paper2,
        "text-background-padding": "2px",
        "text-background-opacity": 1,
        width: 2,
        "line-color": t.ink2,
      },
    },
    { selector: "edge.dimmed", style: { "line-opacity": 0.08 } },

    // --- Core: canvas background -----------------------------------------
    { selector: "core", style: { "active-bg-color": t.ink3, "active-bg-opacity": 0.15 } },
  ];
  return blocks as unknown as StylesheetJson;
}