"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookOpen, ChevronRight, Download, FileText, GitBranch, Monitor, RectangleEllipsis } from "lucide-react";
import type {
  ConversationArtifact,
  ConversationContext,
  ConversationSource,
} from "@/lib/chat/conversation-context";
import { cn } from "@/lib/cn";
import { fastTransition, useMotion } from "@/lib/motion";

type Props = {
  context: ConversationContext;
  variant: "rail" | "sheet";
  onSelectArtifact: (artifact: ConversationArtifact) => void;
  onSelectSource: (source: ConversationSource) => void;
  onDownloadDocument?: (artifact: ConversationArtifact) => void;
};

function artifactMeta(kind: ConversationArtifact["kind"]): string {
  if (kind === "document") return "PDF document";
  if (kind === "diagram") return "Mermaid diagram";
  if (kind === "flashcards") return "Flashcard deck";
  return "Interactive visualization";
}

function ArtifactIcon({ kind }: { kind: ConversationArtifact["kind"] }) {
  if (kind === "diagram") return <GitBranch size={15} strokeWidth={1.7} />;
  if (kind === "visualization") return <Monitor size={15} strokeWidth={1.7} />;
  if (kind === "flashcards") return <RectangleEllipsis size={15} strokeWidth={1.7} />;
  return <FileText size={15} strokeWidth={1.7} />;
}

function RailSection({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const m = useMotion();
  return (
    <section className="border-b border-border/60 px-3 py-3 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="mono flex w-full items-center gap-2 rounded-control px-1 py-1 text-left text-[10px] tracking-wide text-content-muted transition-colors hover:text-content focus-visible:ring-2 focus-visible:ring-ring outline-none"
      >
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={fastTransition} className="text-content-faint">
          <ChevronRight size={13} strokeWidth={1.9} />
        </motion.span>
        {title} <span className="text-content-faint">{count}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div {...m} variants={{ hidden: { opacity: 0, height: 0 }, visible: { opacity: 1, height: "auto", transition: fastTransition }, exit: { opacity: 0, height: 0, transition: fastTransition } }} className="overflow-hidden">
            <div className="pt-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export function ConversationContextPanel({
  context,
  variant,
  onSelectArtifact,
  onSelectSource,
  onDownloadDocument,
}: Props) {
  const [artifactsOpen, setArtifactsOpen] = useState(true);
  const [sourcesOpen, setSourcesOpen] = useState(true);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", variant === "sheet" && "bg-surface")}>
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <PanelsHeading />
        <span className="ml-auto mono text-[10px] tracking-wide text-content-faint">conversation</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <RailSection
          title="Artifacts"
          count={context.artifacts.length}
          open={artifactsOpen}
          onToggle={() => setArtifactsOpen((open) => !open)}
        >
          {context.artifacts.length === 0 ? (
            <p className="px-1 py-2 text-[12px] leading-relaxed text-content-faint">No generated artifacts yet.</p>
          ) : (
            <ul className="space-y-1">
              {context.artifacts.map((artifact) => (
                <li key={artifact.id} className="flex items-center gap-1 rounded-control bg-surface-2/55 p-1">
                  <button
                    type="button"
                    onClick={() => onSelectArtifact(artifact)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-[calc(var(--radius-control)-2px)] px-2 py-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring outline-none"
                    aria-label={`Open ${artifact.label}, ${artifactMeta(artifact.kind)}`}
                  >
                    <span className="shrink-0 text-content-faint"><ArtifactIcon kind={artifact.kind} /></span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-medium text-content">{artifact.label}</span>
                      <span className="mono block text-[9px] tracking-wide text-content-faint">{artifactMeta(artifact.kind)}</span>
                    </span>
                  </button>
                  {artifact.kind === "document" && onDownloadDocument && (
                    <button
                      type="button"
                      onClick={() => onDownloadDocument(artifact)}
                      aria-label={`Download ${artifact.label} as PDF`}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-content-faint transition-colors hover:bg-surface hover:text-content focus-visible:ring-2 focus-visible:ring-ring outline-none"
                    >
                      <Download size={13} strokeWidth={1.8} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </RailSection>
        <RailSection
          title="Sources"
          count={context.sources.length}
          open={sourcesOpen}
          onToggle={() => setSourcesOpen((open) => !open)}
        >
          {context.sources.length === 0 ? (
            <p className="px-1 py-2 text-[12px] leading-relaxed text-content-faint">No course sources cited yet.</p>
          ) : (
            <ul className="space-y-1">
              {context.sources.map((source) => (
                <li key={source.materialId}>
                  <button
                    type="button"
                    onClick={() => onSelectSource(source)}
                    aria-label={`Open ${source.title}, ${source.citationCount} citation${source.citationCount === 1 ? "" : "s"}`}
                    className="flex w-full items-center gap-2 rounded-control bg-surface-2/55 px-3 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring outline-none"
                  >
                    <BookOpen size={15} strokeWidth={1.7} className="shrink-0 text-content-faint" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-content">{source.title}</span>
                      <span className="mono block text-[9px] tracking-wide text-content-faint">
                        {source.citationCount} citation{source.citationCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </RailSection>
      </div>
    </div>
  );
}

function PanelsHeading() {
  return (
    <>
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-control bg-surface-2 text-content-muted">
        <PanelsTopIcon />
      </span>
      <div>
        <p className="text-[13px] font-medium text-content">Context</p>
        <p className="text-[10px] text-content-faint">conversation index</p>
      </div>
    </>
  );
}

function PanelsTopIcon() {
  return <Monitor size={13} strokeWidth={1.75} />;
}
