"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { placeSelectionAction, selectionSnapshot, type SelectionSnapshot } from "./selection";

export function SelectionAskController({ onAsk }: { onAsk: (snapshot: SelectionSnapshot) => void }) {
  const [snapshot, setSnapshot] = useState<SelectionSnapshot | null>(null);

  useEffect(() => {
    const update = () => setSnapshot(selectionSnapshot(window.getSelection()));
    const clear = (event: MouseEvent) => {
      if (!(event.target as Element | null)?.closest("[data-selection-ask]")) setSnapshot(null);
    };
    document.addEventListener("selectionchange", update);
    document.addEventListener("pointerdown", clear);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("pointerdown", clear);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);

  if (!snapshot || typeof document === "undefined") return null;
  const viewport = window.visualViewport ?? { width: window.innerWidth, height: window.innerHeight };
  const position = placeSelectionAction(snapshot.rect, viewport);
  return createPortal(
    <motion.div
      data-selection-ask
      className="fixed z-[60]"
      style={{ left: position.left, top: position.top }}
      initial={{ opacity: 0, y: 6, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 25, mass: 0.7 }}
    >
      <Button
        type="button"
        size="sm"
        variant="primary"
        aria-label="Ask about selected text"
        className="h-9 gap-2 rounded-full border border-ink/10 bg-ink pl-1.5 pr-3.5 text-paper shadow-[0_8px_22px_rgba(24,24,27,0.24)] hover:scale-[1.03] hover:bg-ink"
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          onAsk(snapshot);
          setSnapshot(null);
        }}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-rule text-white"><Sparkles size={13} strokeWidth={2.5} /></span>
        ask
      </Button>
    </motion.div>,
    document.body,
  );
}
