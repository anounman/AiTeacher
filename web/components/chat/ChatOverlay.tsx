"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUp, Loader2, Mic, Quote, Square, X } from "lucide-react";
import { ChatMessage } from "@/components/ChatMessage";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Textarea } from "@/components/ui/Textarea";
import type { OverlayMessage, OverlayThread } from "@/lib/db/schema";
import { useVoiceTyping } from "./useVoiceTyping";
import { useOverlayChat } from "@/lib/chat/use-overlay-chat";

export function ChatOverlay({
  thread,
  initialMessages,
  web,
  allMaterials,
  transcriptionAvailable,
  initialPrompt,
  onClose,
}: {
  thread: OverlayThread;
  initialMessages: OverlayMessage[];
  web: boolean;
  allMaterials?: { id: string; title: string }[];
  transcriptionAvailable?: boolean;
  initialPrompt?: string;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { turns, streaming, error, send, stop } = useOverlayChat(thread, initialMessages, web);
  const voice = useVoiceTyping({ value: draft, onValueChange: setDraft, transcriptionAvailable });
  const narrow = typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;
  const reduceMotion = useReducedMotion();

  // Send the action's prompt as the FIRST overlay turn, exactly once. Only
  // fires when an initialPrompt is supplied AND there are no existing turns
  // (a freshly opened overlay from a study action). A reopened stored overlay
  // already has messages, so this never re-fires. The ref guards against
  // re-render re-sends.
  const sentInitialPromptRef = useRef(false);
  useEffect(() => {
    if (sentInitialPromptRef.current) return;
    if (!initialPrompt || !initialPrompt.trim()) return;
    if (turns.length > 0) return;
    sentInitialPromptRef.current = true;
    void send(initialPrompt);
  }, [initialPrompt, turns.length, send]);

  useEffect(() => {
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        stop();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, stop]);

  const close = () => {
    stop();
    onClose();
  };

  const submitDraft = () => {
    if (!draft.trim() || streaming) return;
    void send(draft);
    setDraft("");
  };

  return (
    <div className="fixed inset-0 z-[55]">
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 bg-ink/30 backdrop-blur-md"
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      />
      <div className={`relative z-10 flex h-full w-full ${narrow ? "items-end" : "items-center justify-center"}`}>
        <motion.section
          role="dialog"
          aria-modal="true"
          aria-label="Ask about selected text"
          className={`flex overflow-hidden border border-border-strong bg-surface shadow-float ${narrow ? "h-[96dvh] w-full rounded-t-[9px]" : "h-[min(96dvh,72rem)] w-[min(72vw,80rem)] min-w-[42rem] rounded-[7px]"}`}
          initial={reduceMotion ? false : { opacity: 0, y: narrow ? 34 : 24, scale: 0.965 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 320, damping: 28, mass: 0.85 }}
        >
          <div className="flex min-h-0 w-full flex-col">
            <header className="flex shrink-0 items-center gap-3 border-b border-border bg-surface-2/60 px-5 py-2.5 tab:px-7">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rule text-white shadow-sm">
                <Quote size={15} strokeWidth={2.25} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-serif text-[18px] font-semibold leading-tight text-ink">Ask about this selection</h2>
                <p className="mono mt-0.5 text-[10px] tracking-[0.12em] text-content-faint">TEMPORARY DISCUSSION · SAVED TO THIS PASSAGE</p>
              </div>
              <IconButton label="Close contextual chat" variant="ghost" size="sm" onClick={close}><X size={16} /></IconButton>
            </header>
            <div className="shrink-0 border-b border-border bg-paper/40 px-5 py-1.5 tab:px-7">
              <div className="mx-auto max-w-3xl rounded-card border border-border bg-surface/80 px-3.5 py-1.5 shadow-sm">
                <p className="mono text-[10px] font-medium tracking-[0.14em] text-content-faint">SELECTED PASSAGE</p>
                <blockquote className="mt-1 max-h-12 overflow-y-auto border-l-2 border-rule pl-3 font-serif text-[14px] leading-relaxed text-content-muted">{thread.selected_text}</blockquote>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-paper/20 px-5 py-3 tab:px-7">
              {turns.length === 0 && (
                <div className="mx-auto max-w-xl py-8 text-center">
                  <p className="font-serif text-2xl leading-tight text-ink">Unpack the part that stopped you.</p>
                  <p className="mt-3 text-[14px] leading-relaxed text-content-muted">This is a temporary side conversation. Your main chat stays exactly where it is.</p>
                </div>
              )}
              <div className="mx-auto max-w-3xl space-y-6">
                {turns.map((turn) => (
                  <ChatMessage
                    key={turn.id}
                    id={turn.id}
                    role={turn.role}
                    content={turn.content}
                    streaming={streaming && turn.role === "assistant"}
                    reasoning={turn.reasoning}
                    status={turn.status}
                    statusLabel={turn.statusLabel}
                    sources={turn.role === "assistant" ? turn.sources : []}
                    allMaterials={allMaterials}
                    ephemeral
                  />
                ))}
              </div>
              {error && <p className="mono mx-auto mt-5 max-w-3xl rounded-[4px] border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger">{error}</p>}
            </div>
            <form className="shrink-0 border-t border-border bg-surface-2/50 px-5 py-2.5 tab:px-7" onSubmit={(event) => { event.preventDefault(); submitDraft(); }}>
              {voice.message && <p className="mono mx-auto mb-2 max-w-3xl text-[11px] text-danger">{voice.message}</p>}
              <div className="mx-auto max-w-3xl">
                <div className="flex gap-2 rounded-card border border-border bg-surface p-2 shadow-sm transition-[border-color,box-shadow] focus-within:border-border-strong focus-within:shadow-card">
                  <Textarea
                    ref={inputRef}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        void submitDraft();
                      }
                    }}
                    placeholder="Ask what you want to understand…"
                    rows={1}
                    disabled={streaming}
                    className="min-h-12 resize-none border-0 bg-transparent shadow-none hover:bg-transparent focus:border-0 focus-visible:ring-0"
                  />
                  <div className="flex shrink-0 flex-col justify-end gap-2">
                    {(voice.speechSupported || transcriptionAvailable) && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        aria-label={voice.transcribing ? "Transcribing…" : voice.listening ? "Stop voice typing" : "Voice type"}
                        title={voice.transcribing ? "Transcribing…" : voice.listening ? "Stop voice typing" : "Voice type"}
                        disabled={streaming || voice.transcribing}
                        onClick={voice.toggleVoice}
                        className={voice.listening ? "animate-pulse border-rule text-rule hover:bg-rule/10" : undefined}
                      >
                        {voice.transcribing ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
                      </Button>
                    )}
                    {streaming ? (
                      <Button type="button" variant="secondary" size="icon" aria-label="Stop response" onClick={stop}><Square size={14} /></Button>
                    ) : (
                      <Button type="submit" variant="primary" size="sm" aria-label="Send question" disabled={!draft.trim()}><ArrowUp size={15} strokeWidth={2.5} />Ask</Button>
                    )}
                  </div>
                </div>
                <p className="mono mt-2 flex justify-between px-1 text-[10px] text-content-faint"><span>Enter to send</span><span>Shift+Enter for a new line</span></p>
              </div>
            </form>
            <div aria-live="polite" className="sr-only">{turns.at(-1)?.statusLabel ?? turns.at(-1)?.status}</div>
          </div>
        </motion.section>
      </div>
    </div>
  );
}
