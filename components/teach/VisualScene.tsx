"use client";

import { useId } from "react";
import type { VisualAction, VisualPlan } from "@/lib/teach/visual-schema";
import { drawMarkupFromArchitecture } from "@/lib/teach/visual-draw";
import { HandWrite } from "./HandWrite";

type ArchitectureAction = Extract<VisualAction, { action: "draw_architecture" }>;

type Point = { x: number; y: number };

function splitLabel(label: string): string[] {
  if (label.length <= 21) return [label];
  const words = label.split(/\s+/);
  const lines: string[] = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (!last || `${last} ${word}`.length > 22) lines.push(word);
    else lines[lines.length - 1] = `${last} ${word}`;
  }
  return lines.slice(0, 2);
}

function nodeRanks(action: ArchitectureAction): Map<string, number> {
  const ids = new Set(action.nodes.map((node) => node.id));
  const incoming = new Map(action.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(action.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of action.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const ranks = new Map(action.nodes.map((node) => [node.id, 0]));
  const queue = action.nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const target of outgoing.get(id) ?? []) {
      ranks.set(target, Math.max(ranks.get(target) ?? 0, (ranks.get(id) ?? 0) + 1));
      incoming.set(target, (incoming.get(target) ?? 1) - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  }

  // Cycles are valid teaching visuals. Place unvisited nodes in consecutive
  // layers instead of failing layout.
  let fallbackRank = Math.max(0, ...ranks.values());
  for (const node of action.nodes) {
    if (!seen.has(node.id)) ranks.set(node.id, fallbackRank++);
  }
  return ranks;
}

function ArchitectureDiagram({ action }: { action: ArchitectureAction }) {
  const markerId = `visual-arrow-${useId().replace(/:/g, "")}`;
  const ranks = nodeRanks(action);
  const layers = new Map<number, ArchitectureAction["nodes"]>();
  for (const node of action.nodes) {
    const rank = ranks.get(node.id) ?? 0;
    layers.set(rank, [...(layers.get(rank) ?? []), node]);
  }
  const orderedLayers = [...layers.entries()].sort((a, b) => a[0] - b[0]);
  const horizontal = action.direction === "left_to_right";
  const nodeW = 154;
  const nodeH = 58;
  const layerGap = horizontal ? 54 : 50;
  const crossGap = 28;
  const pad = 34;
  const maxInLayer = Math.max(1, ...orderedLayers.map(([, nodes]) => nodes.length));
  const width = horizontal
    ? Math.max(520, pad * 2 + orderedLayers.length * nodeW + (orderedLayers.length - 1) * layerGap)
    : Math.max(520, pad * 2 + maxInLayer * nodeW + (maxInLayer - 1) * crossGap);
  const height = horizontal
    ? Math.max(190, pad * 2 + maxInLayer * nodeH + (maxInLayer - 1) * crossGap)
    : Math.max(190, pad * 2 + orderedLayers.length * nodeH + (orderedLayers.length - 1) * layerGap);
  const positions = new Map<string, Point>();

  orderedLayers.forEach(([, nodes], layerIndex) => {
    nodes.forEach((node, index) => {
      if (horizontal) {
        const usedHeight = nodes.length * nodeH + (nodes.length - 1) * crossGap;
        positions.set(node.id, {
          x: pad + layerIndex * (nodeW + layerGap),
          y: (height - usedHeight) / 2 + index * (nodeH + crossGap),
        });
      } else {
        const usedWidth = nodes.length * nodeW + (nodes.length - 1) * crossGap;
        positions.set(node.id, {
          x: (width - usedWidth) / 2 + index * (nodeW + crossGap),
          y: pad + layerIndex * (nodeH + layerGap),
        });
      }
    });
  });

  return (
    <figure className="visual-architecture">
      {action.title && <figcaption>{action.title}</figcaption>}
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={action.title ?? "Architecture diagram"}>
        <defs>
          <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        <g className="visual-edges">
          {action.edges.map((edge, index) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (!from || !to) return null;
            const x1 = from.x + nodeW / 2;
            const y1 = from.y + nodeH / 2;
            const x2 = to.x + nodeW / 2;
            const y2 = to.y + nodeH / 2;
            const bend = horizontal ? Math.abs(x2 - x1) * 0.45 : Math.abs(y2 - y1) * 0.45;
            const d = horizontal
              ? `M ${x1 + nodeW / 2} ${y1} C ${x1 + nodeW / 2 + bend} ${y1}, ${x2 - nodeW / 2 - bend} ${y2}, ${x2 - nodeW / 2} ${y2}`
              : `M ${x1} ${y1 + nodeH / 2} C ${x1} ${y1 + nodeH / 2 + bend}, ${x2} ${y2 - nodeH / 2 - bend}, ${x2} ${y2 - nodeH / 2}`;
            const labelX = (x1 + x2) / 2;
            const labelY = (y1 + y2) / 2 - 7;
            return (
              <g key={`${edge.from}-${edge.to}-${index}`}>
                <path
                  d={d}
                  markerEnd={edge.direction === "none" ? undefined : `url(#${markerId})`}
                  markerStart={edge.direction === "both" ? `url(#${markerId})` : undefined}
                />
                {edge.label && <text x={labelX} y={labelY} className="visual-edge-label">{edge.label}</text>}
              </g>
            );
          })}
        </g>
        <g className="visual-nodes">
          {action.nodes.map((node) => {
            const point = positions.get(node.id)!;
            const lines = splitLabel(node.label);
            return (
              <g key={node.id} transform={`translate(${point.x} ${point.y})`} data-visual-id={node.id}>
                <rect width={nodeW} height={nodeH} rx={node.kind === "decision" ? 18 : 10} className={`visual-node visual-node-${node.kind}`} />
                <text x={nodeW / 2} y={lines.length === 1 ? 34 : 27} textAnchor="middle">
                  {lines.map((line, index) => <tspan key={line} x={nodeW / 2} dy={index === 0 ? 0 : 17}>{line}</tspan>)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </figure>
  );
}

function assetIcon(assetId: string): string {
  if (/person|teacher|student|character/i.test(assetId)) return "person";
  if (/database|store|memory/i.test(assetId)) return "database";
  if (/cloud|server/i.test(assetId)) return "cloud";
  if (/idea|light|insight/i.test(assetId)) return "lightbulb";
  if (/arrow|flow|route/i.test(assetId)) return "route";
  return "category";
}

/**
 * Dataset-ready visual scene. `data-asset-id` is the swap point for the
 * user's future character/arrow artwork; semantic placeholders keep every
 * lesson readable until that catalog is supplied.
 */
export function VisualScene({ plan, instant = false }: { plan: VisualPlan; instant?: boolean }) {
  // Lessons persisted before the director learned to skip hand-drawn boards
  // carry scenes whose nodes are raw board markup ("[DRAW] // ROOT c…") — a
  // boxed duplicate of writing already on the board. Render nothing for those.
  const echoesRawMarkup = plan.actions.some(
    (action) =>
      action.action === "draw_architecture" &&
      action.nodes.some((node) => /\[(?:DRAW|G|T)\]|~~/.test(node.label)),
  );
  if (echoesRawMarkup) return null;
  const architectures = plan.actions.filter(
    (action): action is ArchitectureAction => action.action === "draw_architecture",
  );
  const assets = plan.actions.filter((action) => action.action === "place_asset");
  const labels = plan.actions.filter((action) => action.action === "write_label");
  const arrows = plan.actions.filter((action) => action.action === "draw_arrow");
  const notes = plan.actions.filter(
    (action) => ["arrange_layout", "group_elements", "emphasize"].includes(action.action),
  );

  // Architecture diagrams go on the board in the same hand as everything else
  // (2c.14) — bare ink, no card. The card chrome only remains for the extra
  // action types a future asset catalog will use.
  if (architectures.length && !assets.length && !labels.length && !arrows.length) {
    return (
      <div data-scene-id={plan.sceneId} aria-label={plan.summary ?? "Visual explanation"}>
        {architectures.map((action) => (
          <HandWrite
            key={action.id}
            writeId={action.id}
            itemKey={action.id}
            markup={drawMarkupFromArchitecture(action)}
            instant={instant}
          />
        ))}
      </div>
    );
  }

  return (
    <section className="visual-scene" data-scene-id={plan.sceneId} aria-label={plan.summary ?? "Visual explanation"}>
      <header className="visual-scene-head">
        <span className="material-symbols-outlined" aria-hidden>schema</span>
        <div>
          <p className="visual-kicker">Visual map</p>
          {plan.summary && <h3>{plan.summary}</h3>}
        </div>
      </header>

      {assets.length > 0 && (
        <div className="visual-assets">
          {assets.map((asset) => (
            <div key={asset.id} className={`visual-asset visual-asset-${asset.size}`} data-visual-id={asset.id} data-asset-id={asset.assetId}>
              <span className="material-symbols-outlined" aria-hidden>{assetIcon(asset.assetId)}</span>
              <strong>{asset.label ?? asset.assetId.split("/").at(-1)}</strong>
              <small>{asset.assetId}</small>
            </div>
          ))}
        </div>
      )}

      {architectures.map((action) => <ArchitectureDiagram key={action.id} action={action} />)}

      {(labels.length > 0 || arrows.length > 0) && (
        <div className="visual-relations">
          {labels.map((label) => (
            <div key={label.id} className={`visual-label visual-tone-${label.tone}`} data-visual-id={label.id}>
              <span>{label.role}</span>
              <strong>{label.text}</strong>
            </div>
          ))}
          {arrows.map((arrow) => (
            <div key={arrow.id} className={`visual-relation visual-tone-${arrow.tone}`} data-visual-id={arrow.id}>
              <code>{arrow.from}</code><span aria-hidden>⟶</span><code>{arrow.to}</code>
              {arrow.label && <strong>{arrow.label}</strong>}
            </div>
          ))}
        </div>
      )}

      {notes.length > 0 && (
        <footer className="visual-scene-notes">
          {notes.map((note) => <span key={note.id}>{note.action.replaceAll("_", " ")}</span>)}
        </footer>
      )}
    </section>
  );
}
