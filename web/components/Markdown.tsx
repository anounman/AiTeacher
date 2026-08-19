"use client";

import type { CSSProperties, ReactNode } from "react";
import { MarkdownHooks as ReactMarkdown } from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import rehypePrettyCode from "rehype-pretty-code";
import { CodeBlock } from "./CodeBlock";
import { codeHighlightOptions } from "@/lib/markdown/highlight";
import { Artifact } from "./Artifact";
import { InvalidArtifact, NativeArtifact, type NativeArtifactVersionOverride } from "./artifacts/NativeArtifact";
import { FlashcardDeck } from "./FlashcardDeck";
import { MermaidDiagram } from "./MermaidDiagram";
import { classifyArtifact } from "@/lib/artifacts/schema";
import { extractNativeArtifactEntries, artifactEntryId } from "@/lib/artifacts/entries";
import { extractText } from "@/lib/markdown/extract-text";
import { normalizeMathDelimiters } from "@/lib/markdown/normalize-math";
import { parseBoardFence } from "@/lib/teach/protocol";

type ArtifactVersionChange = (
  entryId: string,
  result: { versionId: string; artifact: import("@/lib/artifacts/schema").NativeArtifact },
) => void;

// Route a fenced code block by its language: an ```artifact fence renders a
// live sandboxed HTML visualization; a ```flashcard fence renders an
// interactive flip deck. Any other fence renders the normal CodeBlock. While
// streaming, an artifact/flashcard fence shows a placeholder — mounting the
// widget on a half-streamed block would reload/re-parse it on every chunk.
// `children` is the inner <code> element react-markdown places inside <pre>;
// its className carries the language as `language-<lang>`.
export function PreBlock({
  children,
  "data-language": dataLanguage,
  className,
  style,
  streaming,
  conversationTitle,
  conversationId,
  messageId,
  artifactVersionOverrides,
  onArtifactVersionChange,
  onArtifactVersionError,
  content,
  ephemeral,
}: {
  children?: ReactNode;
  // rehype-pretty-code (shiki 4) replaces the legacy `language-xxx` class on
  // <code> with a `data-language` attribute on <pre>/<code>. Read it to route
  // artifact/flashcard fences and to label the code block. (The pre's class is
  // forwarded onto CodeBlock's <pre> for any future chrome; shiki emits token
  // colors as --shiki-light/--shiki-dark vars on the spans, themed in CSS.)
  "data-language"?: string;
  className?: string;
  style?: CSSProperties;
  streaming?: boolean;
  conversationTitle?: string;
  conversationId?: string;
  messageId?: string;
  artifactVersionOverrides?: Record<string, NativeArtifactVersionOverride>;
  onArtifactVersionChange?: ArtifactVersionChange;
  onArtifactVersionError?: (message: string) => void;
  // The full markdown content for the message — used to compute the stable
  // artifact entry id (ordinal among artifact/artifact-html fences) that the
  // server also computes via extractNativeArtifactEntries. Only consumed when
  // an artifact fence is being routed.
  content?: string;
  ephemeral?: boolean;
}) {
  const codeEl = (Array.isArray(children) ? children[0] : children) as
    | { props?: { className?: string } }
    | undefined;
  // Fall back to the legacy `language-` class only if a path bypassed the
  // highlighter (defensive — rehype-pretty-code runs on every fence).
  const legacyClassName = codeEl?.props?.className ?? "";
  const lang = dataLanguage ?? /language-([\w-]+)/.exec(legacyClassName)?.[1];
  // Teach-mode board fences are executed on the whiteboard panel, not in the
  // chat transcript. Show a compact placeholder so the transcript reads as a
  // lesson plan rather than raw JSON. The actual board rendering happens in
  // TeachStage via the performer.
  if (lang === "board") {
    const count = parseBoardFence(extractText(children)).length;
    return (
      <div data-selection-excluded className="mono my-2 rounded-control border border-border/60 bg-surface/40 px-3 py-1.5 text-[11px] text-content-faint">
        board · {count || "…"} step{count === 1 ? "" : "s"}
      </div>
    );
  }
  if (lang === "artifact" || lang === "artifact-html") {
    if (streaming) {
      return (
        <div className="mono my-3 flex items-center gap-1.5 rounded-card border border-border bg-surface-2 px-4 py-3 text-[12px] text-content-faint shadow-sm">
          <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-rule" />
          building visualization…
        </div>
      );
    }
    if (lang === "artifact-html") {
      return (
        <div data-selection-excluded>
          <Artifact html={extractText(children)} />
        </div>
      );
    }
    const classification = classifyArtifact(extractText(children));
    if (classification.type === "native") {
      // Compute the SAME stable entry id the server uses
      // (`${messageId}:artifact:${ordinal}`) so the version-override map and
      // the transform/restore endpoints address the exact fence. The ordinal
      // is this fence's index among all artifact/artifact-html fences, which
      // matches extractNativeArtifactEntries' ordinal assignment.
      const entryId = messageId && content
        ? artifactEntryForFence(messageId, content, extractText(children))
        : undefined;
      const override = entryId ? artifactVersionOverrides?.[entryId] : undefined;
      return (
        <div data-selection-excluded>
          <NativeArtifact
            artifact={classification.artifact}
            artifactId={entryId}
            versionOverride={override}
            onVersionChange={entryId && onArtifactVersionChange
              ? (result) => onArtifactVersionChange(entryId, result)
              : undefined}
            onVersionError={onArtifactVersionError}
          />
        </div>
      );
    }
    if (classification.type === "legacy-html") {
      return (
        <div data-selection-excluded>
          <Artifact html={classification.html} />
        </div>
      );
    }
    return (
      <InvalidArtifact source={classification.source} reason={classification.reason} />
    );
  }
  if (lang === "mermaid") {
    if (streaming) {
      return (
        <div className="mono my-3 flex items-center gap-1.5 rounded-card border border-border bg-surface-2 px-4 py-3 text-[12px] text-content-faint shadow-sm">
          <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-rule" />
          building diagram…
        </div>
      );
    }
    return <MermaidDiagram code={extractText(children)} />;
  }
  if (lang === "flashcard") {
    if (streaming) {
      return (
        <div className="mono my-3 flex items-center gap-1.5 rounded-card border border-border bg-surface-2 px-4 py-3 text-[12px] text-content-faint shadow-sm">
          <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-rule" />
          building flashcards…
        </div>
      );
    }
    return (
      <div data-selection-excluded>
        <FlashcardDeck
          source={extractText(children)}
          conversationTitle={conversationTitle}
          conversationId={conversationId}
          reviewMode={ephemeral}
        />
      </div>
    );
  }
  return (
    <CodeBlock className={className} style={style} lang={lang}>
      {children}
    </CodeBlock>
  );
}

// Compute the stable artifact entry id for one rendered fence by matching its
// payload against the entries extracted from the full message content. The
// ordinal in `extractNativeArtifactEntries` counts every artifact/artifact-html
// fence in order (native or not), so this matches the server's id exactly.
// Returns the `${messageId}:artifact:${ordinal}` id, or undefined if the fence
// isn't found among the native entries (e.g. it classified as native here but
// the extractor saw it differently — defensive, falls back to no override).
function artifactEntryForFence(messageId: string, content: string, fenceSource: string): string | undefined {
  const entries = extractNativeArtifactEntries(messageId, content);
  const match = entries.find((entry) => entry.source.trim() === fenceSource.trim());
  return match?.id;
}

// The single markdown-rendering config for the app: remark-math + remark-gfm
// (tables/strikethrough/autolinks/task-lists) + rehype-pretty-code (Shiki
// syntax highlighting — async, so we render via MarkdownHooks, the
// async-capable react-markdown entry) + rehype-katex, with LaTeX delimiters
// normalized before parse so \(...\)/\[...\] also render. `pre` is routed via
// PreBlock (artifact/flashcard vs. CodeBlock). Shared by ChatMessage and the
// /print page so a document renders identically in the chat card and the PDF.
// `conversationTitle`/`conversationId` thread through so an inline flashcard
// deck can title + link the deck it saves to the originating chat.
export function Markdown({
  content,
  className,
  streaming,
  conversationTitle,
  conversationId,
  messageId,
  artifactVersionOverrides,
  onArtifactVersionChange,
  onArtifactVersionError,
  ephemeral,
}: {
  content: string;
  className?: string;
  streaming?: boolean;
  conversationTitle?: string;
  conversationId?: string;
  messageId?: string;
  artifactVersionOverrides?: Record<string, NativeArtifactVersionOverride>;
  onArtifactVersionChange?: ArtifactVersionChange;
  onArtifactVersionError?: (message: string) => void;
  ephemeral?: boolean;
}) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[[rehypePrettyCode, codeHighlightOptions], rehypeKatex]}
        components={{
          pre: (props) => (
            <PreBlock
              {...props}
              streaming={streaming}
              conversationTitle={conversationTitle}
              conversationId={conversationId}
              messageId={messageId}
              artifactVersionOverrides={artifactVersionOverrides}
              onArtifactVersionChange={onArtifactVersionChange}
              onArtifactVersionError={onArtifactVersionError}
              content={content}
              ephemeral={ephemeral}
            />
          ),
        }}
      >
        {normalizeMathDelimiters(content || "")}
      </ReactMarkdown>
    </div>
  );
}
