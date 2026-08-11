"use client";

import { useEffect, useMemo, useRef } from "react";
import type { TeachAction } from "@/lib/teach/protocol";
import type { WorldRect } from "@/lib/teach/performer";
import type { WordCue } from "@/lib/teach/alignment";
import { StrokeText } from "./StrokeText";
import { MathWriteOn } from "./MathWriteOn";
import { MathMark } from "./MathMark";
import { CodeWriteOn } from "./CodeWriteOn";
import { roleFor, HandWrite } from "./HandWrite";
import { VisualScene } from "./VisualScene";
import { ConceptGraphScene } from "./ConceptGraphScene";
import { ClipScene } from "./ClipScene";
import { DiagramScene } from "./DiagramScene";
import type { PositionedGraph } from "@/lib/visual-engine/index";

export interface BoardEntry {
  action: TeachAction;
  key: string;
  live: boolean; // live actions are performed (written); history renders instantly
  // Present on answers to a marked question: the world rect of the mark.
  // These entries render in a margin aside beside that spot instead of the
  // main column — like a teacher annotating next to earlier work.
  anchor?: WorldRect | null;
  // Word graph edges for write actions: written word index → where the voice
  // says it. HandWrite reveals each cued word as the voice clock passes it.
  wordCues?: WordCue[];
  // This beat's narration, for figures whose stroke cues can only be built
  // after the sidecar reports the primitives it drew.
  beatSpeech?: Array<{ eventIndex: number; text: string }>;
}

// Board content on the infinite canvas (TeachStage supplies paper/pan/zoom/
// camera). Main lesson flows down a single column; anchored answers become
// margin asides absolutely positioned beside their mark. `onGrow` hands the
// newest item's element to the stage so the camera can follow the pen.
export function Board({
  entries,
  onGrow,
}: {
  entries: BoardEntry[];
  onGrow?: (el: HTMLElement) => void;
}) {
  const lastRef = useRef<HTMLDivElement>(null);

  const { sections, asides, boxed } = useMemo(() => {
    const sections: BoardEntry[][] = [[]];
    // Asides grouped by lesson (key prefix `l-<id>-`), keeping one container
    // per answer even when it has several items.
    const asides = new Map<string, { anchor: WorldRect; items: BoardEntry[] }>();
    const boxed = new Set<string>();
    // Directed scenes persisted by earlier lessons often just restate the
    // board: architecture nodes whose labels copy headings/lines already
    // written by hand. Rendering those draws the same words twice. Drop any
    // scene where most node labels are prefixes of existing write markup.
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const written = entries
      .filter((e) => e.action.type === "write")
      .map((e) => norm((e.action as { markup: string }).markup));
    const echoesBoard = (e: BoardEntry): boolean => {
      if (e.action.type !== "visual_scene") return false;
      const labels = e.action.plan.actions
        .filter((a): a is Extract<typeof a, { action: "draw_architecture" }> => a.action === "draw_architecture")
        // Math-heavy labels ("= 4 + 5h + h²") normalize to very short strings
        // — an 8-char floor let a pure-equation echo scene slip through.
        .flatMap((a) => a.nodes.map((n) => norm(n.label)))
        .filter((l) => l.length >= 4);
      if (!labels.length) return false;
      const echoed = labels.filter((l) => written.some((w) => w.startsWith(l) || l.startsWith(w.slice(0, 40)))).length;
      return echoed >= Math.ceil(labels.length / 2);
    };
    for (const e of entries) {
      if (echoesBoard(e)) continue;
      if (e.action.type === "box") {
        boxed.add(e.action.around);
        continue;
      }
      if (e.anchor) {
        const group = e.key.replace(/-\d+$/, "");
        const g = asides.get(group) ?? { anchor: e.anchor, items: [] };
        if (e.action.type !== "new_page") g.items.push(e);
        asides.set(group, g);
        continue;
      }
      if (e.action.type === "new_page") sections.push([]);
      else sections[sections.length - 1]!.push(e);
    }
    return { sections, asides: Array.from(asides.entries()), boxed };
  }, [entries]);

  useEffect(() => {
    const el = lastRef.current;
    if (el && onGrow) onGrow(el);
  }, [entries.length, onGrow]);

  const lastKey = entries.length ? entries[entries.length - 1]!.key : null;

  const renderItem = (e: BoardEntry) => (
    <div
      key={e.key}
      data-entry-key={e.key}
      ref={e.key === lastKey ? lastRef : undefined}
      // A heading, an equation and a margin note are all `write` actions, so
      // uniform spacing gave every lesson the same wall of evenly-packed
      // lines. The role the renderer already infers for SIZE decides the
      // rhythm too: a new topic gets air above it, an annotation tucks under
      // the thing it annotates.
      className={`board-item board-item-${e.action.type} ${
        e.action.type === "write"
          ? `board-write-${roleFor(e.action.markup, e.action.color ?? "ink")}`
          : ""
      } ${
        "id" in e.action && e.action.id && boxed.has(e.action.id) ? "board-item-boxed" : ""
      }`}
    >
      <BoardItem entry={e} />
    </div>
  );

  return (
    <div className="board-world">
      {sections.map((section, si) => (
        <section key={si} className="board-section">
          {si > 0 && <div className="board-divider" aria-hidden />}
          {section.map(renderItem)}
        </section>
      ))}
      {asides.map(([group, g]) => (
        <div
          key={group}
          className="board-aside"
          // Always in the true margin, left of the 900px column — anchoring at
          // `anchor.x - 460` planted the note ON the column whenever the mark
          // sat within 460px of its left edge. Vertical overlaps between
          // asides and column content are resolved by the repair pass.
          style={{ left: -470, top: g.anchor.y, width: 420 }}
        >
          <div className="board-aside-tick" aria-hidden />
          {g.items.map(renderItem)}
        </div>
      ))}
    </div>
  );
}

function BoardItem({ entry }: { entry: BoardEntry }) {
  const { action, key, live } = entry;
  switch (action.type) {
    case "write":
      return (
        <HandWrite
          markup={action.markup}
          writeId={action.id ?? key}
          color={action.color}
          itemKey={live ? key : undefined}
          instant={!live}
          wordCues={live ? entry.wordCues : undefined}
          beatSpeech={live ? entry.beatSpeech : undefined}
        />
      );
    case "code":
      return (
        <CodeWriteOn
          code={action.code}
          codeId={action.id ?? key}
          itemKey={live ? key : undefined}
          instant={!live}
        />
      );
    case "mark":
      return (
        <MathMark
          target={action.target}
          style={action.style}
          label={action.label}
          color={action.color}
          itemKey={live ? key : undefined}
          instant={!live}
        />
      );
    // Legacy actions — earlier lessons and models that ignore the write action.
    case "heading":
      return <StrokeText text={action.text} heading itemKey={key} instant={!live} />;
    case "text":
      return <StrokeText text={action.text} itemKey={key} instant={!live} />;
    case "latex":
      return (
        <MathWriteOn
          tex={action.tex}
          eqId={action.id}
          itemKey={live ? key : undefined}
          instant={!live}
        />
      );
    case "arrow":
      return (
        <div className="mono flex items-center gap-2 pl-4 text-[12px] text-feynman">
          <span aria-hidden>↳</span>
          <span>{action.label ?? `${action.from} → ${action.to}`}</span>
        </div>
      );
    case "visual_scene":
      return <VisualScene plan={action.plan} instant={!live} />;
    case "diagram":
      return <DiagramScene action={action} itemKey={key} />;
    case "clip":
      return <ClipScene action={action} itemKey={key} instant={!live} />;
    case "concept_graph":
      return (
        <ConceptGraphScene
          graph={action.graph as PositionedGraph | null}
          title={action.title}
          summary={action.summary}
        />
      );
    case "spacer":
      return <div style={{ height: action.h }} aria-hidden />;
    default:
      return null;
  }
}
