"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { StudyAction } from "@/lib/chat/study-actions";

const DISMISS_KEY = (messageId: string) => `studygpt:study-actions:${messageId}`;

export function StudyActions({
  messageId,
  actions,
  onSelect,
}: {
  messageId: string;
  actions: StudyAction[];
  onSelect: (action: StudyAction) => void;
}) {
  const [dismissed, setDismissed] = useState(() => {
    // Server/test path: read the key eagerly so static markup reflects the
    // dismissed state (the node test runner stubs globalThis.sessionStorage).
    // Client path: defer to the effect below so the first client render
    // matches the server render and avoids a hydration mismatch.
    if (typeof window !== "undefined") return false;
    try {
      const g = globalThis as { sessionStorage?: Storage };
      return g.sessionStorage ? g.sessionStorage.getItem(DISMISS_KEY(messageId)) === "1" : false;
    } catch {
      return false;
    }
  });

  // Reconcile with the real sessionStorage after mount. sessionStorage survives
  // in-tab navigation, so a dismissed action does not reappear for that
  // message even after switching conversations and returning.
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && window.sessionStorage.getItem(DISMISS_KEY(messageId))) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDismissed(true);
      }
    } catch {
      // sessionStorage unavailable (private mode) — treat as not dismissed.
    }
  }, [messageId]);

  if (dismissed || actions.length === 0) return null;

  function dismiss() {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISS_KEY(messageId), "1");
    } catch {
      // ignore — non-persistent dismissal is still valid for the session.
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {actions.slice(0, 2).map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={() => onSelect(action)}
          className="mono inline-flex items-center rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] text-content-muted transition-[transform,border-color,background-color,box-shadow] duration-fast ease-out hover:-translate-y-px hover:border-border-strong hover:bg-surface-2 hover:text-content hover:shadow-sm"
        >
          {action.label}
        </button>
      ))}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss suggested actions"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-content-faint transition-colors hover:bg-surface-2 hover:text-content"
      >
        <X size={12} />
      </button>
    </div>
  );
}