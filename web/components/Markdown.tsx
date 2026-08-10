"use client";

import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { CodeBlock } from "./CodeBlock";
import { Artifact } from "./Artifact";
import { FlashcardDeck } from "./FlashcardDeck";
import { extractText } from "@/lib/markdown/extract-text";
import { normalizeMathDelimiters } from "@/lib/markdown/normalize-math";
import { parseBoardFence } from "@/lib/teach/protocol";

// Route a fenced code block by its language: an ```artifact fence renders a
// live sandboxed HTML visualization; a ```flashcard fence renders an
// interactive flip deck. Any other fence renders the normal CodeBlock. While
// streaming, an artifact/flashcard fence shows a placeholder — mounting the
// widget on a half-streamed block would reload/re-parse it on every chunk.
// `children` is the inner <code> element react-markdown places inside <pre>;
// its className carries the language as `language-<lang>`.
function PreBlock({
  children,
  streaming,
  conversationTitle,
  conversationId,
}: {
  children?: ReactNode;
  streaming?: boolean;
  conversationTitle?: string;
  conversationId?: string;
}) {
  const codeEl = (Array.isArray(children) ? children[0] : children) as
    | { props?: { className?: string } }
    | undefined;
  const className = codeEl?.props?.className ?? "";
  const lang = /language-([\w-]+)/.exec(className)?.[1];
  if (lang === "artifact") {
    if (streaming) {
      return (
        <div className="mono my-2 rounded-[3px] border border-line bg-paper-2 px-4 py-3 text-[12px] text-ink-3">
          building visualization…
        </div>
      );
    }
    return <Artifact html={extractText(children)} />;
  }
  // Teach-mode board fences are executed on the whiteboard panel, not in the
  // transcript — show a compact step chip instead of raw JSON.
  if (lang === "board") {
    const count = parseBoardFence(extractText(children)).length;
    return (
      <div className="mono my-2 inline-flex items-center gap-2 rounded-[3px] border border-line bg-paper-2 px-3 py-1.5 text-[11px] text-ink-3">
        <span aria-hidden>✎</span>
        <span>
          board · {count || "…"} step{count === 1 ? "" : "s"}
        </span>
      </div>
    );
  }
  if (lang === "flashcard") {
    if (streaming) {
      return (
        <div className="mono my-2 rounded-[3px] border border-line bg-paper-2 px-4 py-3 text-[12px] text-ink-3">
          building flashcards…
        </div>
      );
    }
    return (
      <FlashcardDeck
        source={extractText(children)}
        conversationTitle={conversationTitle}
        conversationId={conversationId}
      />
    );
  }
  return <CodeBlock>{children}</CodeBlock>;
}

function sourceLinks(content: string): string {
  return content.replace(
    /\[S:([a-zA-Z0-9_-]+)\]/g,
    (_marker, id: string) => `[source](#source-${id})`,
  );
}

// The single markdown-rendering config for the app: remark-math + remark-gfm
// (tables/strikethrough/autolinks/task-lists) + rehype-katex, with LaTeX
// delimiters normalized before parse so \(...\)/\[...\] also render. `pre` is
// routed via PreBlock (artifact/flashcard vs. CodeBlock). Shared by ChatMessage
// and the /print page so a document renders identically in the chat card and
// the PDF. `conversationTitle`/`conversationId` thread through so an inline
// flashcard deck can title + link the deck it saves to the originating chat.
export function Markdown({
  content,
  className,
  streaming,
  conversationTitle,
  conversationId,
}: {
  content: string;
  className?: string;
  streaming?: boolean;
  conversationTitle?: string;
  conversationId?: string;
}) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={{
          pre: (props) => (
            <PreBlock
              {...props}
              streaming={streaming}
              conversationTitle={conversationTitle}
              conversationId={conversationId}
            />
          ),
          a: ({ href, children, ...props }) => {
            if (href?.startsWith("#source-")) {
              const sourceId = href.slice("#source-".length);
              return (
                <a
                  {...props}
                  href={href}
                  onClick={(event) => {
                    event.preventDefault();
                    window.dispatchEvent(new CustomEvent("open-source", { detail: sourceId }));
                  }}
                  className="mono inline-flex rounded-full border border-feynman/30 bg-feynman/10 px-1.5 py-0.5 text-[9px] font-medium no-underline text-feynman hover:bg-feynman/15"
                >
                  {children}
                </a>
              );
            }
            return <a {...props} href={href}>{children}</a>;
          },
        }}
      >
        {normalizeMathDelimiters(sourceLinks(content || ""))}
      </ReactMarkdown>
    </div>
  );
}
