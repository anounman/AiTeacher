"use client";

import { motion } from "motion/react";
import type { ConversationMode } from "@/lib/db/schema";
import { cn } from "@/lib/cn";
import { useLayoutMotion } from "@/lib/motion";

interface Props {
  mode: ConversationMode;
  onChange: (mode: ConversationMode) => void;
}

// Segmented control. Color encodes the mode: ink for Chat, chalk-blue for
// Feynman, rule-orange for Teach — so the active state tells you which kind
// of session you're in.
export function ModeToggle({ mode, onChange }: Props) {
  const layoutTransition = useLayoutMotion();

  return (
    <div className="mono inline-flex rounded-card border border-border bg-surface-2 p-1 text-[11px] tracking-wide shadow-sm">
      <button
        type="button"
        onClick={() => onChange("chat")}
        aria-pressed={mode === "chat"}
        className={cn(
          "relative isolate rounded-control px-3 py-1.5 transition-colors duration-fast ease-out",
          mode === "chat" ? "text-paper-2" : "text-content-faint hover:text-content",
        )}
      >
        {mode === "chat" && (
          <motion.span
            aria-hidden
            layoutId="active-mode-indicator"
            transition={layoutTransition}
            className="absolute inset-0 z-0 rounded-control bg-ink shadow-sm"
          />
        )}
        <span className="relative z-10">Chat</span>
      </button>
      <button
        type="button"
        onClick={() => onChange("feynman")}
        aria-pressed={mode === "feynman"}
        title="You explain concepts back; the tutor critiques the gaps."
        className={cn(
          "relative isolate rounded-control px-3 py-1.5 transition-colors duration-fast ease-out",
          mode === "feynman" ? "text-paper-2" : "text-content-faint hover:text-content",
        )}
      >
        {mode === "feynman" && (
          <motion.span
            aria-hidden
            layoutId="active-mode-indicator"
            transition={layoutTransition}
            className="absolute inset-0 z-0 rounded-control bg-feynman shadow-sm"
          />
        )}
        <span className="relative z-10">Feynman</span>
      </button>
      <button
        type="button"
        onClick={() => onChange("teach")}
        aria-pressed={mode === "teach"}
        title="The tutor talks and writes the lesson on a whiteboard."
        className={cn(
          "relative isolate rounded-control px-3 py-1.5 transition-colors duration-fast ease-out",
          mode === "teach" ? "text-paper-2" : "text-content-faint hover:text-content",
        )}
      >
        {mode === "teach" && (
          <motion.span
            aria-hidden
            layoutId="active-mode-indicator"
            transition={layoutTransition}
            className="absolute inset-0 z-0 rounded-control bg-rule shadow-sm"
          />
        )}
        <span className="relative z-10">Teach</span>
      </button>
    </div>
  );
}