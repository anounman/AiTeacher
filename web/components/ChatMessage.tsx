"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Copy, Check, RefreshCw, Pencil, Download, X, Paperclip } from "lucide-react";
import { Markdown } from "./Markdown";
import { SourcesPanel } from "./SourcesPanel";
import { OverlaySourceMarkers } from "./chat/OverlaySourceMarkers";
import { AnswerInsights } from "./chat/AnswerInsights";
import { SourceCitationStrip } from "./chat/SourceCitationStrip";
import { StudyActions } from "./chat/StudyActions";
import { IconButton } from "@/components/ui/IconButton";
import { Button } from "@/components/ui/Button";
import { useMotion, fadeUp } from "@/lib/motion";
import { normalizeLabel } from "@/lib/concepts/slug";
import { estimateTokens, userTurnText } from "@/lib/tokens";
import type { SourceEntry, Attachment, MessageActivity, MessageGrounding } from "@/lib/db/schema";
import type { OverlayAnchor } from "@/lib/chat/overlay-threads";
import type { StudyAction } from "@/lib/chat/study-actions";
import { interruptedReplyLabel } from "@/lib/chat/delivery-state";

// Shallow equality on the attachments an edit produced vs. the originals, so
// we only persist (and re-run) when something actually changed. Compares by
// identity of each attachment's distinguishing fields; attachments are
// immutable once created (image data URLs / inlined file text).
function sameAttachments(a: Attachment[], b: Attachment[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.type !== y.type) return false;
    if (x.type === "image" && y.type === "image") {
      if (x.dataUrl !== y.dataUrl || x.name !== y.name) return false;
    } else if (x.type === "file" && y.type === "file") {
      if (x.name !== y.name || x.text !== y.text) return false;
    } else {
      return false;
    }
  }
  return true;
}

interface Props {
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
  sources?: SourceEntry[];
  activities?: MessageActivity[];
  grounding?: MessageGrounding | null;
  attachments?: Attachment[] | null;
  kind?: "chat" | "document";
  deliveryState?: "complete" | "interrupted";
  id?: string;
  onCopy?: () => void;
  onRegenerate?: () => void;
  onEdit?: (newContent: string, attachments: Attachment[]) => void;
  canRegenerate?: boolean;
  conversationTitle?: string;
  conversationId?: string;
  status?: string;
  // Server-supplied dynamic label, preferred over the static STATUS_LABELS
  // map so the UI can show data-driven steps like "found 3 relevant
  // passages…" or 'searching the web for "…"' without a code change per phase.
  statusLabel?: string;
  reasoning?: string;
  allMaterials?: { id: string; title: string }[];
  ephemeral?: boolean;
  overlayAnchors?: OverlayAnchor[];
  onOpenOverlay?: (anchor: OverlayAnchor) => void;
  onOpenSource?: (source: SourceEntry) => void;
  studyActions?: StudyAction[];
  onStudyAction?: (action: StudyAction) => void;
  // Native-artifact version overrides keyed by stable entry id, plus the
  // change/error handlers that the in-artifact version menu calls. Threaded
  // through Markdown → NativeArtifact so an edited version replaces the
  // immutable parsed payload for its fence only.
  artifactVersionOverrides?: Record<string, import("@/components/artifacts/NativeArtifact").NativeArtifactVersionOverride>;
  onArtifactVersionChange?: (entryId: string, result: { versionId: string; artifact: import("@/lib/artifacts/schema").NativeArtifact }) => void;
  onArtifactVersionError?: (message: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  thinking: "thinking…",
  "reading-materials": "reading your materials…",
  "searching-materials": "searching your materials…",
  "found-sources": "reading your materials…",
  "drafting-document": "drafting document…",
  searching: "searching the web…",
  writing: "writing…",
  // Diagram-notation pipeline phases (normally sent WITH a dynamic label, so
  // these are just a safe fallback if a status event ever arrives without one).
  "notation-reading-slides": "looking at your slides…",
  "studying-notation": "studying your course's notation…",
  "recalling-notation": "recalling your course's notation…",
  "notation-ready": "drawing the diagram…",
};

export function ChatMessage({
  role,
  content,
  streaming,
  sources,
  activities,
  grounding,
  attachments,
  kind,
  deliveryState = "complete",
  id,
  onCopy,
  onRegenerate,
  onEdit,
  canRegenerate,
  conversationTitle,
  conversationId,
  status,
  statusLabel,
  reasoning,
  allMaterials,
  ephemeral = false,
  overlayAnchors = [],
  onOpenOverlay,
  onOpenSource,
  studyActions,
  onStudyAction,
  artifactVersionOverrides,
  onArtifactVersionChange,
  onArtifactVersionError,
}: Props) {
  const isUser = role === "user";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [draftAttachments, setDraftAttachments] = useState<Attachment[]>([]);
  const [copied, setCopied] = useState(false);
  const [pdfState, setPdfState] = useState<"idle" | "rendering" | "done" | "error">("idle");
  // Token estimate for this message: content + any inlined file/OCR text.
  const tok = estimateTokens(userTurnText(content, attachments));
  const m = useMotion();

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable — silent
    }
    onCopy?.();
  }

  function commitEdit() {
    const t = draft.trim();
    if (!t) return;
    const atts = draftAttachments;
    setEditing(false);
    const contentChanged = t !== content;
    const attsChanged = !sameAttachments(atts, attachments ?? []);
    if (contentChanged || attsChanged) onEdit?.(t, atts);
  }

  function cancelEdit() {
    setDraft(content);
    setDraftAttachments(attachments ? [...attachments] : []);
    setEditing(false);
  }

  function removeDraftAttachment(i: number) {
    setDraftAttachments((prev) => prev.filter((_, idx) => idx !== i));
  }

  function startEdit() {
    setDraft(content);
    setDraftAttachments(attachments ? [...attachments] : []);
    setEditing(true);
  }

  // Hit the server-side PDF route and trigger a real .pdf download — no new
  // tab, no second click. The route renders the existing /print/[id] page in
  // headless Chromium and returns the bytes; we just blob+download them.
  async function downloadPdf() {
    if (!id || pdfState === "rendering") return;
    setPdfState("rendering");
    try {
      const res = await fetch(`/api/messages/${id}/pdf`);
      if (!res.ok) throw new Error(res.statusText || "render failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${normalizeLabel(conversationTitle ?? "") || "document"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setPdfState("done");
      setTimeout(() => setPdfState("idle"), 1500);
    } catch {
      setPdfState("error");
      setTimeout(() => setPdfState("idle"), 2000);
    }
  }

  if (isUser && editing) {
    return (
      <motion.div {...m} variants={fadeUp}>
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commitEdit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelEdit();
            }
          }}
          rows={Math.min(8, Math.max(1, draft.split("\n").length))}
          className="mono w-full resize-none rounded-card border border-border bg-surface-2/40 px-3.5 py-3 text-[13px] leading-6 text-ink outline-none focus:border-border-strong focus-visible:ring-2 focus-visible:ring-ring-accent/60"
        />
        {draftAttachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2 pl-5">
            {draftAttachments.map((a, i) =>
              a.type === "image" ? (
                <div key={i} className="relative">
                  <img
                    src={a.dataUrl}
                    alt={a.name}
                    className="max-h-20 rounded-control border border-border object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => removeDraftAttachment(i)}
                    aria-label="Remove attachment"
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-surface text-content-faint hover:text-rule"
                  >
                    <X size={10} />
                  </button>
                </div>
              ) : (
                <span
                  key={i}
                  className="mono flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-content-muted"
                >
                  <Paperclip size={11} /> {a.name} ({a.charCount.toLocaleString()}c)
                  <button
                    type="button"
                    onClick={() => removeDraftAttachment(i)}
                    aria-label="Remove attachment"
                    className="text-content-faint hover:text-rule"
                  >
                    <X size={11} />
                  </button>
                </span>
              ),
            )}
          </div>
        )}
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={cancelEdit}>
            cancel
          </Button>
          <Button variant="accent" size="sm" onClick={commitEdit}>
            save
          </Button>
        </div>
      </motion.div>
    );
  }

  if (isUser) {
    return (
      <motion.div {...m} variants={fadeUp} className="group relative">
        <div className="rounded-card border border-border bg-surface px-4 py-3 font-mono italic text-[13px] leading-relaxed text-content shadow-card">
          {content}
        </div>
        {attachments && attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2 pl-5">
            {attachments.map((a, i) =>
              a.type === "image" ? (
                <img
                  key={i}
                  src={a.dataUrl}
                  alt={a.name}
                  className="max-h-32 rounded-control border border-border object-contain"
                />
              ) : (
                <span
                  key={i}
                  className="mono flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-content-muted"
                >
                  <Paperclip size={11} /> {a.name} ({a.charCount.toLocaleString()}c)
                </span>
              ),
            )}
          </div>
        )}
        {(onEdit || (canRegenerate && onRegenerate)) && (
          <div className="absolute -right-1 top-0 flex items-center gap-1">
            {canRegenerate && onRegenerate && (
              <IconButton variant="ghost" size="sm" label="Regenerate reply" onClick={onRegenerate}>
                <RefreshCw size={12} />
              </IconButton>
            )}
            {onEdit && (
              <IconButton variant="ghost" size="sm" label="Edit message" onClick={startEdit}>
                <Pencil size={12} />
              </IconButton>
            )}
          </div>
        )}
      </motion.div>
    );
  }

  if (kind === "document") {
    return (
      <motion.div {...m} variants={fadeUp} className="group relative">
        {status && (
          <div className="mono mb-2 flex items-center gap-1.5 text-[11px] text-content-faint">
            <span className="h-1.5 w-1.5 rounded-full bg-rule animate-pulse" />
            {statusLabel ?? STATUS_LABELS[status] ?? status}
          </div>
        )}
        {reasoning && (
          <details className="mb-3 rounded-card border border-border bg-surface-2/50 px-3.5 py-2.5 shadow-sm">
            <summary className="mono text-[11px] text-content-faint">thinking</summary>
            <Markdown content={reasoning} className="prose-chat mt-2 text-[13px] text-content-muted" />
          </details>
        )}
        <OverlaySourceMarkers anchors={overlayAnchors} onOpen={onOpenOverlay ?? (() => {})}>
          <div data-selectable-answer={role === "assistant" && !streaming && !ephemeral ? id : undefined}>
            <Markdown
              content={content}
              className="prose-chat text-ink"
              streaming={streaming}
              conversationTitle={conversationTitle}
              conversationId={conversationId}
              messageId={id}
              artifactVersionOverrides={artifactVersionOverrides}
              onArtifactVersionChange={onArtifactVersionChange}
              onArtifactVersionError={onArtifactVersionError}
              ephemeral={ephemeral}
            />
          </div>
        </OverlaySourceMarkers>
        {streaming && (
          <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-rule" />
        )}
        {!streaming && (
          <>
            <div className={`absolute right-0 ${overlayAnchors.length ? "top-8" : "top-0"} flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100`}>
              <IconButton variant="ghost" size="sm" label={copied ? "Copied" : "Copy document"} onClick={copy}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </IconButton>
              {canRegenerate && onRegenerate && (
                <IconButton variant="ghost" size="sm" label="Regenerate" onClick={onRegenerate}>
                  <RefreshCw size={13} />
                </IconButton>
              )}
            </div>
            {id && !ephemeral && (
              <div className="mono mt-5 flex flex-wrap items-center gap-3 text-[12px] tracking-wide">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={downloadPdf}
                  disabled={pdfState === "rendering"}
                >
                  <Download size={14} />
                  {pdfState === "rendering" ? "rendering PDF…" : pdfState === "done" ? "downloaded" : pdfState === "error" ? "failed — retry" : "download PDF"}
                </Button>
                <a
                  href={`/print/${id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-content-faint transition-colors hover:text-ink"
                >
                  open preview
                </a>
              </div>
            )}
            <SourceCitationStrip sources={sources ?? []} onOpenSource={onOpenSource} />
            <SourcesPanel sources={sources ?? []} allMaterials={allMaterials} />
            <AnswerInsights activities={activities} grounding={grounding} />
            {deliveryState === "interrupted" && interruptedReplyLabel(content) && (
              <div className="mono mt-4 flex items-center gap-2 text-[11px] text-content-faint">
                <span>{interruptedReplyLabel(content)}</span>
                {canRegenerate && onRegenerate && <Button variant="ghost" size="sm" onClick={onRegenerate}>retry</Button>}
              </div>
            )}
          </>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div {...m} variants={fadeUp} className="group relative">
      {status && (
        <div className="mono mb-2 flex items-center gap-1.5 text-[11px] text-content-faint">
          <span className="h-1.5 w-1.5 rounded-full bg-rule animate-pulse" />
          {statusLabel ?? STATUS_LABELS[status] ?? status}
        </div>
      )}
      {reasoning && (
        <details className="mb-3 rounded-card border border-border bg-surface-2/50 px-3.5 py-2.5 shadow-sm">
          <summary className="mono text-[11px] text-content-faint">thinking</summary>
          <Markdown content={reasoning} className="prose-chat mt-2 text-[13px] text-content-muted" />
        </details>
      )}
      <OverlaySourceMarkers anchors={overlayAnchors} onOpen={onOpenOverlay ?? (() => {})}>
        <div data-selectable-answer={role === "assistant" && !streaming && !ephemeral ? id : undefined}>
          <Markdown
            content={content}
            className="prose-chat text-ink"
            streaming={streaming}
            conversationTitle={conversationTitle}
            conversationId={conversationId}
            messageId={id}
            artifactVersionOverrides={artifactVersionOverrides}
            onArtifactVersionChange={onArtifactVersionChange}
            onArtifactVersionError={onArtifactVersionError}
            ephemeral={ephemeral}
          />
        </div>
      </OverlaySourceMarkers>
      {streaming && (
        <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-rule" />
      )}
      {!streaming && (
        <>
          <div className={`absolute right-0 ${overlayAnchors.length ? "top-8" : "top-0"} flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100`}>
            <IconButton variant="ghost" size="sm" label={copied ? "Copied" : "Copy message"} onClick={copy}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </IconButton>
            {canRegenerate && onRegenerate && (
              <IconButton variant="ghost" size="sm" label="Regenerate" onClick={onRegenerate}>
                <RefreshCw size={13} />
              </IconButton>
            )}
          </div>
          <SourceCitationStrip sources={sources ?? []} onOpenSource={onOpenSource} />
          <SourcesPanel sources={sources ?? []} allMaterials={allMaterials} />
          <AnswerInsights activities={activities} grounding={grounding} />
          <div className="mono mt-1 text-[10px] text-content-faint">· {tok.toLocaleString()} tok</div>
          {studyActions && studyActions.length > 0 && onStudyAction && (
            <StudyActions messageId={id ?? ""} actions={studyActions} onSelect={onStudyAction} />
          )}
          {deliveryState === "interrupted" && interruptedReplyLabel(content) && (
            <div className="mono mt-4 flex items-center gap-2 text-[11px] text-content-faint">
              <span>{interruptedReplyLabel(content)}</span>
              {canRegenerate && onRegenerate && <Button variant="ghost" size="sm" onClick={onRegenerate}>retry</Button>}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
