import { registerKind, hasOnlyKeys, isPlainObject, boundedString } from "../registry";

// Native figure DSL — a data-only vector vocabulary the platform renders to
// inline SVG. The notation-faithful home for diagrams Mermaid's named types
// can't express (Chen-style ER, directed transaction graphs, custom course
// notation). The model supplies *what* and *where* (shapes, connectors,
// coordinates it chose from the learned notation note); the platform owns
// *how it looks* (stroke, color tokens, font, arrowheads). Keeps the data-only
// contract: no HTML/CSS/JS/arbitrary SVG/URLs in the envelope.

export type ShapeKind = "entity" | "relationship" | "attribute" | "state" | "process" | "class" | "note";

export type Shape =
  | { id: string; type: "rect" | "rounded" | "diamond" | "oval" | "circle"; x: number; y: number; w: number; h: number; label?: string; kind?: ShapeKind }
  | { id: string; type: "text"; x: number; y: number; text: string; size?: number };

export type Connector = {
  id: string;
  from: string;
  to: string;
  style?: "solid" | "dashed" | "double";
  arrow?: "none" | "forward" | "both";
  label?: string;
  cardinality?: string;
};

export type LegendEntry = { label: string; swatch: "solid" | "dashed" | "diamond" | "rect" | "oval" };

export type FigureData = {
  width?: number;
  height?: number;
  shapes: Shape[];
  connectors?: Connector[];
  legend?: LegendEntry[];
};

const MAX_SHAPES = 120;
const MAX_CONNECTORS = 160;
const MAX_TOTAL_LABEL_CHARS = 2000;
const MAX_LEGEND = 12;

const SHAPE_TYPES = new Set(["rect", "rounded", "diamond", "oval", "circle", "text"]);
const SHAPE_KINDS = new Set(["entity", "relationship", "attribute", "state", "process", "class", "note"]);
const CONNECTOR_STYLES = new Set(["solid", "dashed", "double"]);
const ARROW_TYPES = new Set(["none", "forward", "both"]);
const SWATCHES = new Set(["solid", "dashed", "diamond", "rect", "oval"]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateShape(shape: unknown, labelBudget: { used: number }): Shape | null {
  if (!isPlainObject(shape) || typeof shape.id !== "string" || !shape.id) return null;
  if (typeof shape.type !== "string" || !SHAPE_TYPES.has(shape.type)) return null;

  if (shape.type === "text") {
    if (typeof shape.text !== "string" || !shape.text) return null;
    if (!isFiniteNumber(shape.x) || !isFiniteNumber(shape.y)) return null;
    if (shape.size !== undefined && !isFiniteNumber(shape.size)) return null;
    labelBudget.used += shape.text.length;
    if (labelBudget.used > MAX_TOTAL_LABEL_CHARS) return null;
    return { id: shape.id, type: "text", x: shape.x, y: shape.y, text: shape.text, ...(shape.size !== undefined ? { size: shape.size } : {}) };
  }

  // Box shapes: rect, rounded, diamond, oval, circle.
  if (!isFiniteNumber(shape.x) || !isFiniteNumber(shape.y) || !isFiniteNumber(shape.w) || !isFiniteNumber(shape.h)) return null;
  if (shape.label !== undefined && !boundedString(shape.label, 200)) return null;
  if (shape.kind !== undefined && (typeof shape.kind !== "string" || !SHAPE_KINDS.has(shape.kind))) return null;
  if (shape.label !== undefined) {
    labelBudget.used += shape.label.length;
    if (labelBudget.used > MAX_TOTAL_LABEL_CHARS) return null;
  }
  return {
    id: shape.id,
    type: shape.type as "rect" | "rounded" | "diamond" | "oval" | "circle",
    x: shape.x, y: shape.y, w: shape.w, h: shape.h,
    ...(shape.label !== undefined ? { label: shape.label } : {}),
    ...(shape.kind !== undefined ? { kind: shape.kind as ShapeKind } : {}),
  };
}

function validateConnector(conn: unknown, shapeIds: Set<string>, labelBudget: { used: number }): Connector | null {
  if (!isPlainObject(conn)) return null;
  if (!hasOnlyKeys(conn, ["id", "from", "to", "style", "arrow", "label", "cardinality"])) return null;
  if (typeof conn.id !== "string" || !conn.id) return null;
  if (typeof conn.from !== "string" || typeof conn.to !== "string") return null;
  if (!shapeIds.has(conn.from) || !shapeIds.has(conn.to)) return null;
  if (conn.style !== undefined && (typeof conn.style !== "string" || !CONNECTOR_STYLES.has(conn.style))) return null;
  if (conn.arrow !== undefined && (typeof conn.arrow !== "string" || !ARROW_TYPES.has(conn.arrow))) return null;
  if (conn.label !== undefined && !boundedString(conn.label, 100)) return null;
  if (conn.cardinality !== undefined && !boundedString(conn.cardinality, 40)) return null;
  if (conn.label !== undefined) {
    labelBudget.used += conn.label.length;
    if (labelBudget.used > MAX_TOTAL_LABEL_CHARS) return null;
  }
  if (conn.cardinality !== undefined) {
    labelBudget.used += conn.cardinality.length;
    if (labelBudget.used > MAX_TOTAL_LABEL_CHARS) return null;
  }
  return {
    id: conn.id, from: conn.from, to: conn.to,
    ...(conn.style !== undefined ? { style: conn.style as Connector["style"] } : {}),
    ...(conn.arrow !== undefined ? { arrow: conn.arrow as Connector["arrow"] } : {}),
    ...(conn.label !== undefined ? { label: conn.label } : {}),
    ...(conn.cardinality !== undefined ? { cardinality: conn.cardinality } : {}),
  };
}

function validateLegendEntry(entry: unknown): LegendEntry | null {
  if (!isPlainObject(entry) || !hasOnlyKeys(entry, ["label", "swatch"])) return null;
  if (typeof entry.label !== "string" || !boundedString(entry.label, 200)) return null;
  if (typeof entry.swatch !== "string" || !SWATCHES.has(entry.swatch)) return null;
  return { label: entry.label, swatch: entry.swatch as LegendEntry["swatch"] };
}

registerKind({
  kind: "figure",
  label: "Figure",
  promptSpec: `data:{width?:number,height?:number,shapes:[{id,type:"rect"|"rounded"|"diamond"|"oval"|"circle"|"text",x,y,w?,h?,label?,kind?}],connectors?:[{id,from,to,style?,arrow?,label?,cardinality?}],legend?:[{label,swatch}]}`,
  // ER-flavored and graph ad-hoc kinds try `figure` first (notation-faithful
  // DSL), then `diagram` (Mermaid) as a fallback when the model emitted Mermaid
  // content. Registered AFTER diagram, so for `erm` the candidate order is
  // [figure, diagram] — figure gets first crack.
  aliases: [
    "er", "erm", "erd", "er-model", "er-diagram", "entity-relationship",
    "relationship-diagram", "schema-diagram", "er-schema", "data-model", "conceptual-model",
    "graph", "precedence-graph", "conflict-graph", "wait-for-graph",
    "dependency-graph", "transaction-graph", "serializability-graph", "serialization-graph",
  ],
  validate(data): { ok: true; data: FigureData } | { ok: false; reason: string } {
    const d = data as Record<string, unknown>;
    if (!hasOnlyKeys(d, ["width", "height", "shapes", "connectors", "legend"])) {
      return { ok: false, reason: "Figure data must contain shapes (and optional width/height/connectors/legend)" };
    }
    if (d.width !== undefined && !isFiniteNumber(d.width)) return { ok: false, reason: "Figure width must be a finite number" };
    if (d.height !== undefined && !isFiniteNumber(d.height)) return { ok: false, reason: "Figure height must be a finite number" };
    if (!Array.isArray(d.shapes) || d.shapes.length === 0 || d.shapes.length > MAX_SHAPES) {
      return { ok: false, reason: `Figure must contain between 1 and ${MAX_SHAPES} shapes` };
    }

    const labelBudget = { used: 0 };
    const shapes: Shape[] = [];
    const shapeIds = new Set<string>();
    for (const shape of d.shapes) {
      const validated = validateShape(shape, labelBudget);
      if (!validated) return { ok: false, reason: "Figure contains an invalid shape (check id, type, coordinates, and label bounds)" };
      if (shapeIds.has(validated.id)) return { ok: false, reason: "Figure shape ids must be unique" };
      shapeIds.add(validated.id);
      shapes.push(validated);
    }

    const connectors: Connector[] = [];
    if (d.connectors !== undefined) {
      if (!Array.isArray(d.connectors) || d.connectors.length > MAX_CONNECTORS) {
        return { ok: false, reason: `Figure connectors must contain at most ${MAX_CONNECTORS} entries` };
      }
      const connIds = new Set<string>();
      for (const conn of d.connectors) {
        const validated = validateConnector(conn, shapeIds, labelBudget);
        if (!validated) return { ok: false, reason: "Figure contains an invalid connector (check id, from/to refs, style, and label bounds)" };
        if (connIds.has(validated.id)) return { ok: false, reason: "Figure connector ids must be unique" };
        connIds.add(validated.id);
        connectors.push(validated);
      }
    }

    const legend: LegendEntry[] = [];
    if (d.legend !== undefined) {
      if (!Array.isArray(d.legend) || d.legend.length > MAX_LEGEND) {
        return { ok: false, reason: `Figure legend must contain at most ${MAX_LEGEND} entries` };
      }
      for (const entry of d.legend) {
        const validated = validateLegendEntry(entry);
        if (!validated) return { ok: false, reason: "Figure legend entries must have a label and a valid swatch" };
        legend.push(validated);
      }
    }

    return {
      ok: true,
      data: {
        shapes,
        ...(d.width !== undefined ? { width: d.width } : {}),
        ...(d.height !== undefined ? { height: d.height } : {}),
        ...(connectors.length > 0 ? { connectors } : {}),
        ...(legend.length > 0 ? { legend } : {}),
      },
    };
  },
});
