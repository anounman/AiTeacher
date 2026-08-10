"use client";

import { useState, type ReactNode } from "react";
import { extractText } from "@/lib/markdown/extract-text";

interface PreProps {
  children?: ReactNode;
}

export function CodeBlock({ children }: PreProps) {
  const [copied, setCopied] = useState(false);
  const text = extractText(children);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable — silent
    }
  }

  return (
    <div className="relative">
      <button
        onClick={copy}
        aria-label="Copy code"
        className="no-print mono absolute right-2 top-2 z-10 rounded-[2px] border border-line bg-paper-2 px-1.5 py-0.5 text-[10px] tracking-wide text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
      >
        {copied ? "copied" : "copy"}
      </button>
      <pre>{children}</pre>
    </div>
  );
}