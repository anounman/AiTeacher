"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Copy, Check } from "lucide-react";
import { extractText } from "@/lib/markdown/extract-text";

interface PreProps {
  children?: ReactNode;
  // <pre> class ("shiki" + language) and inline style (Shiki CSS vars) from
  // rehype-pretty-code — forwarded onto the <pre> so the dark-theme swap in
  // globals.css (html[data-theme=dark] .shiki span → var(--shiki-dark)) applies.
  className?: string;
  style?: CSSProperties;
  // Fenced language (e.g. "ts"), shown as a small hover label top-left.
  // Omitted for plaintext / unfenced blocks and the artifact/flashcard fences.
  lang?: string;
}

// Languages that don't merit a label: plaintext/unfenced (no tokens to brand),
// and the two special fences routed elsewhere (Artifact / FlashcardDeck).
const NO_LABEL_LANGS = new Set(["text", "plaintext", "artifact", "flashcard", "mermaid"]);

export function CodeBlock({ children, className, style, lang }: PreProps) {
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

  const showLang = !!lang && !NO_LABEL_LANGS.has(lang);

  return (
    <div className="group/code relative">
      {showLang && (
        <span className="mono no-print pointer-events-none absolute left-3 top-2 z-10 text-[10px] tracking-wide text-content-faint opacity-0 transition-opacity group-hover/code:opacity-100">
          {lang}
        </span>
      )}
      <button
        onClick={copy}
        aria-label="Copy code"
        className="no-print absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-control text-content-faint opacity-0 transition-opacity hover:bg-surface-2 hover:text-content group-hover/code:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring outline-none"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <pre className={className} style={style}>
        {children}
      </pre>
    </div>
  );
}
