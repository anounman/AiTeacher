"use client";

import { useState, useMemo } from "react";
import { Markdown } from "./Markdown";
import { SourcesPanel } from "./SourcesPanel";
import { estimateTokens, userTurnText } from "@/lib/tokens";
import type { SourceEntry, Attachment, MessageActivity, MessageGrounding } from "@/lib/db/schema";

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
  attachments?: Attachment[] | null;
  // 'document' marks a one-shot authored document — rendered as a wider
  // page-like sheet with a Print/Save-as-PDF action instead of the chat
  // bubble. The print link needs the message id.
  kind?: "chat" | "document";
  id?: string;
  onCopy?: () => void;
  onRegenerate?: () => void;
  onEdit?: (newContent: string, attachments: Attachment[]) => void;
  canRegenerate?: boolean;
  // Passed through to <Markdown> so an inline ```flashcard deck can title and
  // link the deck it saves back to this conversation.
  conversationTitle?: string;
  conversationId?: string;
  // Live status phase while streaming ("thinking" | "reading-materials" |
  // "drafting-document" | "searching" | "writing"). Rendered as a thin mono
  // status line above the bubble while truthy.
  status?: string;
  // Optional human-readable label the server sends with a status event, used
  // INSTEAD of the static phase→label map so the server can show dynamic,
  // data-driven steps ("found 3 relevant passages…").
  statusLabel?: string;
  // True for ephemeral overlay messages — disables selection markers and
  // artifact versioning (overlay threads aren't the main chat).
  ephemeral?: boolean;
  // Whether the message was fully delivered or interrupted (regenerate/edit).
  deliveryState?: "complete" | "interrupted";
  // Server-side activities (search/material/notation phases) + grounding info
  // for the answer insights panel.
  activities?: MessageActivity[];
  grounding?: MessageGrounding | null;
  // Overlay anchors (stored source-marker highlights) for this message.
  overlayAnchors?: import("@/lib/chat/overlay-threads").OverlayAnchor[];
  // Open an overlay anchored to a specific passage in this message.
  onOpenOverlay?: (anchor: import("@/lib/chat/overlay-threads").OverlayAnchor) => void;
  // Open the evidence dialog for a specific source.
  onOpenSource?: (source: SourceEntry) => void;
  // Study actions suggested for this message.
  studyActions?: import("@/lib/chat/study-actions").StudyAction[];
  // Fire a study action (opens overlay with the action's prompt).
  onStudyAction?: (action: import("@/lib/chat/study-actions").StudyAction) => void;
  // Artifact version overrides (edited/transformed native artifacts).
  artifactVersionOverrides?: Record<string, import("@/components/artifacts/NativeArtifact").NativeArtifactVersionOverride>;
  onArtifactVersionChange?: (entryId: string, result: { versionId: string; artifact: import("@/lib/artifacts/schema").NativeArtifact }) => void;
  onArtifactVersionError?: (message: string) => void;
  // The message id — needed for artifact versioning and selection markers.
  messageId?: string;
  // Model reasoning (thinking trace) streamed in. Rendered in a collapsible
  // <details> panel above the content, via <Markdown>.
  reasoning?: string;
  // All materials in the active project — threaded through to SourcesPanel so
  // it can show every material and mark which were used in this answer.
  allMaterials?: { id: string; title: string }[];
}

// Maps a streaming status phase to the small label shown above the bubble.
const STATUS_LABELS: Record<string, string> = {
  thinking: "thinking…",
  "reading-materials": "reading your materials…",
  "drafting-document": "drafting document…",
  searching: "searching the web…",
  writing: "writing…",
};

export function ChatMessage({
  role,
  content,
  streaming,
  sources,
  attachments,
  kind,
  id,
  onCopy,
  onRegenerate,
  onEdit,
  canRegenerate,
  conversationTitle,
  conversationId,
  status,
  statusLabel,
  ephemeral = false,
  deliveryState = "complete",
  activities,
  grounding,
  overlayAnchors = [],
  onOpenOverlay,
  onOpenSource,
  studyActions,
  onStudyAction,
  artifactVersionOverrides,
  onArtifactVersionChange,
  onArtifactVersionError,
  messageId,
  reasoning,
  allMaterials,
}: Props) {
  const isUser = role === "user";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [draftAttachments, setDraftAttachments] = useState<Attachment[]>([]);
  const [copied, setCopied] = useState(false);
  // Token estimate for this message: content + any inlined file/OCR text from
  // attachments — what the model actually consumed. Memoized so streaming
  // (content grows per chunk) only recomputes when content/attachments change.
  const tok = useMemo(
    () => estimateTokens(userTurnText(content, attachments)),
    [content, attachments],
  );

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
    // Commit when either the text changed or attachments changed. Always pass
    // the surviving attachment list so the parent + route can persist it.
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

  if (isUser && editing) {
    return (
      <div className="flex justify-end">
        <div className="w-[80%] max-w-[80%] rounded-r-[3px] rounded-l-[2px] border-l-2 border-rule bg-paper-3 px-4 py-2.5">
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
            className="mono w-full resize-none rounded-[2px] border border-line bg-paper-2 px-2 py-1 text-[13px] leading-6 text-ink outline-none focus:border-ink"
          />
          {draftAttachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {draftAttachments.map((a, i) =>
                a.type === "image" ? (
                  <div
                    key={i}
                    className="relative">
                    <img
                      src={a.dataUrl}
                      alt={a.name}
                      className="max-h-20 rounded-[2px] border border-line object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => removeDraftAttachment(i)}
                      aria-label="Remove attachment"
                      className="mono absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-line bg-paper-2 text-[10px] text-ink-3 hover:text-rule"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <span
                    key={i}
                    className="mono flex items-center gap-1.5 rounded-[2px] border border-line bg-paper-2 px-2 py-0.5 text-[11px] text-ink-2"
                  >
                    📎 {a.name} ({a.charCount.toLocaleString()}c)
                    <button
                      type="button"
                      onClick={() => removeDraftAttachment(i)}
                      aria-label="Remove attachment"
                      className="text-ink-3 hover:text-rule"
                    >
                      ×
                    </button>
                  </span>
                ),
              )}
            </div>
          )}
          <div className="mono mt-1 flex justify-end gap-3 text-[10px] tracking-wide text-ink-3">
            <button onClick={cancelEdit} className="hover:text-ink">
              cancel
            </button>
            <button onClick={commitEdit} className="text-rule hover:opacity-80">
              save ↵
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="group flex justify-end">
        <div className="max-w-[80%] rounded-r-[3px] rounded-l-[2px] border-l-2 border-rule bg-paper-3 px-4 py-2.5">
          <div className="mono mb-1 flex items-center justify-end gap-2 text-[10px] tracking-wide text-rule">
            <span>you</span>
            <span className="text-ink-3">· {tok.toLocaleString()} tok</span>
            {onEdit && (
              <button
                onClick={() => {
                  setDraft(content);
                  setDraftAttachments(attachments ? [...attachments] : []);
                  setEditing(true);
                }}
                aria-label="Edit and resend"
                className="opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
              >
                edit
              </button>
            )}
          </div>
          <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
            {content}
          </div>
          {attachments && attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {attachments.map((a, i) =>
                a.type === "image" ? (
                  <img
                    key={i}
                    src={a.dataUrl}
                    alt={a.name}
                    className="max-h-32 rounded-[2px] border border-line object-contain"
                  />
                ) : (
                  <span
                    key={i}
                    className="mono rounded-[2px] border border-line bg-paper-2 px-2 py-0.5 text-[11px] text-ink-2"
                  >
                    📎 {a.name} ({a.charCount.toLocaleString()}c)
                  </span>
                ),
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (kind === "document") {
    return (
      <div className="group flex justify-start">
        <div className="max-w-[680px] rounded-[3px] border border-line bg-paper-2 px-8 py-7 shadow-card">
          <div className="mono mb-3 flex items-center gap-2 text-[10px] tracking-wide text-ink-3">
            <span className="h-1 w-1 rounded-full bg-rule" />
            document
            <span>· {tok.toLocaleString()} tok</span>
            <div className="ml-auto flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
              <button onClick={copy} aria-label="Copy document" className="hover:text-ink">
                {copied ? "copied" : "copy"}
              </button>
              {canRegenerate && onRegenerate && !streaming && (
                <button onClick={onRegenerate} aria-label="Regenerate" className="hover:text-ink">
                  regen
                </button>
              )}
            </div>
          </div>
          {status && (
            <div className="mono mb-2 flex items-center gap-1.5 text-[10px] tracking-wide text-ink-3">
              <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-feynman" />
              {statusLabel ?? STATUS_LABELS[status] ?? status}
            </div>
          )}
          {reasoning && (
            <details className="mb-3 rounded-[2px] border border-line bg-paper-3/60 px-3 py-2">
              <summary className="mono cursor-pointer text-[10px] tracking-wide text-ink-3 hover:text-ink">
                thinking
              </summary>
              <Markdown content={reasoning} className="prose-chat mt-2 text-[13px] text-ink-2" />
            </details>
          )}
          <Markdown
            content={content}
            className="prose-chat text-ink"
            streaming={streaming}
            conversationTitle={conversationTitle}
            conversationId={conversationId}
          />
          {streaming && (
            <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-rule" />
          )}
          {!streaming && id && (
            <div className="mono mt-5 flex items-center gap-3 text-[12px] tracking-wide">
              <a
                href={`/print/${id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-[3px] bg-ink px-4 py-1.5 text-paper-2 transition-opacity hover:opacity-90"
              >
                download PDF →
              </a>
              <span className="text-ink-3">opens a clean page, then click save as PDF</span>
            </div>
          )}
          {!streaming && (
            <SourcesPanel sources={sources ?? []} allMaterials={allMaterials} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="group flex justify-start">
      <div className="msg-bubble max-w-[85%] rounded-[3px] border border-line bg-paper-2 px-5 py-4 shadow-card">
        <div className="mono mb-1.5 flex items-center gap-1.5 text-[10px] tracking-wide text-ink-3">
          <span className="h-1 w-1 rounded-full bg-rule" />
          studygpt
          <span>· {tok.toLocaleString()} tok</span>
          <div className="ml-auto flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
            <button onClick={copy} aria-label="Copy message" className="hover:text-ink">
              {copied ? "copied" : "copy"}
            </button>
            {canRegenerate && onRegenerate && !streaming && (
              <button onClick={onRegenerate} aria-label="Regenerate" className="hover:text-ink">
                regen
              </button>
            )}
          </div>
        </div>
        {status && (
          <div className="mono mb-2 flex items-center gap-1.5 text-[10px] tracking-wide text-ink-3">
            <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-feynman" />
            {statusLabel ?? STATUS_LABELS[status] ?? status}
          </div>
        )}
        {reasoning && (
          <details className="mb-3 rounded-[2px] border border-line bg-paper-3/60 px-3 py-2">
            <summary className="mono cursor-pointer text-[10px] tracking-wide text-ink-3 hover:text-ink">
              thinking
            </summary>
            <Markdown content={reasoning} className="prose-chat mt-2 text-[13px] text-ink-2" />
          </details>
        )}
        <Markdown
          content={content}
          className="prose-chat text-ink"
          streaming={streaming}
          conversationTitle={conversationTitle}
          conversationId={conversationId}
        />
        {streaming && (
          <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-rule" />
        )}
        {!streaming && (
          <SourcesPanel sources={sources ?? []} allMaterials={allMaterials} />
        )}
      </div>
    </div>
  );
}