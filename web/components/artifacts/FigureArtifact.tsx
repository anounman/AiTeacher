import { useId } from "react";
import type { FigureData, Shape, Connector, LegendEntry, ShapeKind } from "@/lib/artifacts/kinds/figure";

interface FigureArtifactProps extends FigureData {
  title?: string;
  summary?: string;
}

const DEFAULT_W = 640;
const DEFAULT_H = 400;
const STROKE = 1.6;
const FONT = 12;
const ARROW_HEAD = 7;

// Map a shape's semantic `kind` tag to a stroke-color class so the platform
// (not the model) owns color. The notation block steers which `kind` tags the
// model uses (e.g. Chen ER: entity=rect/kind:entity, relationship=diamond/
// kind:relationship); this maps those tags to the platform accent for visual
// distinction without the model naming colors.
const KIND_CLASS: Partial<Record<ShapeKind, string>> = {
  entity: "text-content",
  relationship: "text-rule",
  attribute: "text-content-muted",
  state: "text-content",
  process: "text-rule",
  class: "text-content",
  note: "text-content-faint",
};

// Center of a box shape (for connector endpoints).
function center(shape: Extract<Shape, { w: number }>): { x: number; y: number } {
  return { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 };
}

// Edge intersection of a line from a box center toward a target point — so
// connectors touch the box border, not the center. Approximates the box as a
// rectangle (good enough for rect/rounded/diamond/oval at typical sizes).
function edgePoint(shape: Extract<Shape, { w: number }>, toward: { x: number; y: number }): { x: number; y: number } {
  const c = center(shape);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = shape.w / 2;
  const hh = shape.h / 2;
  // Scale to the box's border: the smaller t that hits an edge.
  const tx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

function shapeKey(id: string, suffix: string): string {
  return `${id}-${suffix}`;
}

function renderShape(shape: Shape, index: number): { svg: React.ReactNode; center: { x: number; y: number } | null } {
  const kindClass = shape.type === "text" ? "text-content" : (KIND_CLASS[shape.kind ?? "entity"] ?? "text-content");

  if (shape.type === "text") {
    const size = shape.size ?? FONT;
    return {
      svg: (
        <text
          key={shapeKey(shape.id, "text")}
          x={shape.x}
          y={shape.y}
          className="fill-current text-content"
          fontSize={size}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {shape.text}
        </text>
      ),
      center: null,
    };
  }

  const label = shape.label;
  const labelEl = label && (
    <text
      key={shapeKey(shape.id, "label")}
      x={shape.x + shape.w / 2}
      y={shape.y + shape.h / 2}
      className={`fill-current ${kindClass}`}
      fontSize={FONT}
      textAnchor="middle"
      dominantBaseline="middle"
    >
      {label}
    </text>
  );

  const common = {
    className: kindClass,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: STROKE,
  };

  let body: React.ReactNode;
  switch (shape.type) {
    case "rect":
      body = <rect {...common} x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={2} />;
      break;
    case "rounded":
      body = <rect {...common} x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={10} />;
      break;
    case "diamond": {
      const cx = shape.x + shape.w / 2;
      const cy = shape.y + shape.h / 2;
      const pts = `${cx},${shape.y} ${shape.x + shape.w},${cy} ${cx},${shape.y + shape.h} ${shape.x},${cy}`;
      body = <polygon {...common} points={pts} />;
      break;
    }
    case "oval":
    case "circle":
      body = <ellipse {...common} cx={shape.x + shape.w / 2} cy={shape.y + shape.h / 2} rx={shape.w / 2} ry={shape.h / 2} />;
      break;
    default:
      body = null;
  }

  return {
    svg: <g key={`g-${shape.id}`}>{body}{labelEl}</g>,
    center: center(shape),
  };
}

function renderConnector(
  conn: Connector,
  fromShape: Extract<Shape, { w: number }>,
  toShape: Extract<Shape, { w: number }>,
  idPrefix: string,
): React.ReactNode {
  const fromCenter = center(fromShape);
  const toCenter = center(toShape);
  const from = edgePoint(fromShape, toCenter);
  const to = edgePoint(toShape, fromCenter);

  const style = conn.style ?? "solid";
  const arrow = conn.arrow ?? "forward";
  const dash = style === "dashed" ? "5 4" : undefined;
  const strokeWidth = style === "double" ? STROKE + 0.8 : STROKE;

  // Arrowhead marker — defined inline per-connector so the color tracks
  // currentColor. A second head is drawn at the start for "both".
  const headId = `${idPrefix}-${conn.id}`;
  const head = (
    <marker
      id={headId}
      markerWidth={ARROW_HEAD}
      markerHeight={ARROW_HEAD}
      refX={ARROW_HEAD - 1}
      refY={ARROW_HEAD / 2}
      orient="auto"
      markerUnits="userSpaceOnUse"
    >
      <path d={`M0,0 L${ARROW_HEAD},${ARROW_HEAD / 2} L0,${ARROW_HEAD} z`} className="fill-current text-content" />
    </marker>
  );
  const headIdBack = `${headId}-back`;
  const headBack = (
    <marker
      id={headIdBack}
      markerWidth={ARROW_HEAD}
      markerHeight={ARROW_HEAD}
      refX={1}
      refY={ARROW_HEAD / 2}
      orient="auto"
      markerUnits="userSpaceOnUse"
    >
      <path d={`M${ARROW_HEAD},0 L0,${ARROW_HEAD / 2} L${ARROW_HEAD},${ARROW_HEAD} z`} className="fill-current text-content" />
    </marker>
  );

  // Label midpoint (slightly offset above the line).
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2 - 8;
  const labelText = conn.label ?? conn.cardinality;
  const labelEl = labelText && (
    <text x={midX} y={midY} className="fill-current text-content-muted" fontSize={10} textAnchor="middle">
      {labelText}
      {conn.label && conn.cardinality ? ` (${conn.cardinality})` : ""}
    </text>
  );

  return (
    <g key={`g-${conn.id}`} className="text-content">
      {head}
      {arrow === "both" && headBack}
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
        markerEnd={arrow === "forward" || arrow === "both" ? `url(#${headId})` : undefined}
        markerStart={arrow === "both" ? `url(#${headIdBack})` : undefined}
      />
      {labelEl}
    </g>
  );
}

function renderLegendEntry(entry: LegendEntry, index: number): React.ReactNode {
  const swatchX = 8;
  const y = 14 + index * 18;
  let swatch: React.ReactNode;
  switch (entry.swatch) {
    case "solid":
      swatch = <line x1={swatchX} y1={y} x2={swatchX + 22} y2={y} stroke="currentColor" strokeWidth={STROKE} className="text-content" />;
      break;
    case "dashed":
      swatch = <line x1={swatchX} y1={y} x2={swatchX + 22} y2={y} stroke="currentColor" strokeWidth={STROKE} strokeDasharray="5 4" className="text-content" />;
      break;
    case "diamond": {
      const cx = swatchX + 11;
      const cy = y;
      const pts = `${cx},${cy - 6} ${swatchX + 22},${cy} ${cx},${cy + 6} ${swatchX},${cy}`;
      swatch = <polygon points={pts} fill="none" stroke="currentColor" strokeWidth={STROKE} className="text-content" />;
      break;
    }
    case "rect":
      swatch = <rect x={swatchX} y={y - 6} width={22} height={12} rx={2} fill="none" stroke="currentColor" strokeWidth={STROKE} className="text-content" />;
      break;
    case "oval":
      swatch = <ellipse cx={swatchX + 11} cy={y} rx={11} ry={6} fill="none" stroke="currentColor" strokeWidth={STROKE} className="text-content" />;
      break;
  }
  return (
    <g key={`legend-${index}`}>
      {swatch}
      <text x={swatchX + 30} y={y + 1} className="fill-current text-content-muted" fontSize={11} dominantBaseline="middle">
        {entry.label}
      </text>
    </g>
  );
}

export function FigureArtifact({ shapes, connectors, legend, width, height, title, summary }: FigureArtifactProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const w = width ?? DEFAULT_W;
  const h = height ?? DEFAULT_H;
  const chartTitle = title ?? "Figure";
  const description = summary ?? `Figure with ${shapes.length} shape${shapes.length === 1 ? "" : "s"}.`;

  // Index box shapes by id for connector endpoint lookup.
  const boxShapes = new Map<string, Extract<Shape, { w: number }>>();
  for (const s of shapes) {
    if (s.type !== "text") boxShapes.set(s.id, s);
  }

  const legendHeight = legend && legend.length > 0 ? 24 + legend.length * 18 : 0;
  const totalHeight = h + legendHeight;

  return (
    <div className="mx-auto w-full max-w-5xl overflow-hidden">
      <svg
        viewBox={`0 0 ${w} ${totalHeight}`}
        role="img"
        aria-labelledby={`artifact-figure-title-${uid} artifact-figure-desc-${uid}`}
        className="h-auto w-full text-content"
      >
        <title id={`artifact-figure-title-${uid}`}>{chartTitle}</title>
        <desc id={`artifact-figure-desc-${uid}`}>{description}</desc>
        {shapes.map((shape, i) => renderShape(shape, i).svg)}
        {connectors?.map((conn) => {
          const from = boxShapes.get(conn.from);
          const to = boxShapes.get(conn.to);
          if (!from || !to) return null;
          return renderConnector(conn, from, to, uid);
        })}
        {legend && legend.length > 0 && (
          <g transform={`translate(0, ${h + 4})`}>
            <line x1={0} y1={0} x2={w} y2={0} stroke="currentColor" strokeOpacity={0.12} className="text-content" />
            {legend.map((entry, i) => renderLegendEntry(entry, i))}
          </g>
        )}
      </svg>
    </div>
  );
}
