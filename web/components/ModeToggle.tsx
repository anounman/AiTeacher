"use client";

import type { ConversationMode } from "@/lib/db/schema";

interface Props {
  mode: ConversationMode;
  onChange: (mode: ConversationMode) => void;
}

// Color encodes the mode: ink for Chat, chalk-blue for Feynman — so the
// active state tells you which kind of session you're in at a glance.
export function ModeToggle({ mode, onChange }: Props) {
  return (
    <div className="mono inline-flex rounded-[3px] border border-line bg-paper-2 p-0.5 text-[11px] tracking-wide">
      <button
        onClick={() => onChange("chat")}
        className={`rounded-[2px] px-2.5 py-1 transition-colors ${
          mode === "chat"
            ? "bg-ink text-paper-2"
            : "text-ink-3 hover:text-ink"
        }`}
      >
        Chat
      </button>
      <button
        onClick={() => onChange("feynman")}
        title="You explain concepts back; the tutor critiques the gaps."
        className={`rounded-[2px] px-2.5 py-1 transition-colors ${
          mode === "feynman"
            ? "bg-feynman text-paper-2"
            : "text-ink-3 hover:text-ink"
        }`}
      >
        Feynman
      </button>
      <button
        onClick={() => onChange("teach")}
        title="The tutor talks and writes the lesson on a whiteboard."
        className={`rounded-[2px] px-2.5 py-1 transition-colors ${
          mode === "teach"
            ? "bg-rule text-paper-2"
            : "text-ink-3 hover:text-ink"
        }`}
      >
        Teach
      </button>
    </div>
  );
}