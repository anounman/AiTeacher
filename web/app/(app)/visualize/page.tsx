"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { VisualCanvas } from "@/components/visual/VisualCanvas";
import type { PositionedGraph } from "@/lib/visual-engine/index";

// Entry point for the visual engine (lib/visual-engine, vendored from
// github.com/JayanshJ/study-visual-engine). Its own page rather than a mode
// inside app/page.tsx: this is a standalone tool, and keeping it out of the
// chat shell means it can be reworked — or dropped into teach mode — without
// touching the page every other feature also edits.

interface Meta {
  model: string;
  diagramType: string;
  template: string | null;
  attempts: number;
  repaired: boolean;
  fellBack: boolean;
  truncated: boolean;
}

const EXAMPLES = [
  "binary search",
  "how a half adder works",
  "the water cycle",
  "tree data structures",
  "causes of World War I",
];

export default function VisualizePage() {
  const [query, setQuery] = useState("");
  const [graph, setGraph] = useState<PositionedGraph | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/visualize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
        // A cold cloud model plus up to two repair rounds; the engine's own
        // budget fires long before this does.
        signal: AbortSignal.timeout(4 * 60_000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `visualize ${res.status}`);
      setGraph(data.graph);
      setMeta(data.meta);
      setTitle(data.doc?.title ?? "");
      setSummary(data.doc?.summary ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "visualize failed");
      setGraph(null);
      setMeta(null);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-10">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl" style={{ fontFamily: "var(--font-serif)" }}>
          Visualize
        </h1>
        <Link href="/" className="mono text-[11px] text-ink-3 hover:text-ink">
          ← back
        </Link>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(query);
        }}
        className="flex gap-2"
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="A concept to draw — “binary search”, “the water cycle”…"
          className="flex-1 rounded-xl border border-line bg-paper-2 px-4 py-3 text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
        />
        <button
          type="submit"
          disabled={busy || !query.trim()}
          className="rounded-xl border border-line bg-paper-2 px-5 py-3 text-ink transition-colors hover:bg-paper-3 disabled:opacity-40"
        >
          {busy ? "drawing…" : "Draw"}
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            disabled={busy}
            onClick={() => {
              setQuery(example);
              void run(example);
            }}
            className="mono rounded-full border border-line px-3 py-1 text-[11px] text-ink-3 transition-colors hover:text-ink disabled:opacity-40"
          >
            {example}
          </button>
        ))}
      </div>

      {error && (
        <p className="mono rounded-xl border border-line bg-paper-2 px-4 py-3 text-[12px] text-feynman">
          {error}
        </p>
      )}

      {title && (
        <section className="flex flex-col gap-1">
          <h2 className="text-lg" style={{ fontFamily: "var(--font-serif)" }}>
            {title}
          </h2>
          {summary && <p className="text-ink-2">{summary}</p>}
        </section>
      )}

      {graph && (
        <div className="overflow-x-auto rounded-xl border border-line bg-paper-2 p-4">
          <VisualCanvas graph={graph} />
        </div>
      )}

      {meta && (
        // How the diagram was reached, not just the diagram. "generic and
        // vague" and "the model failed twice and we fell back" look identical
        // on screen otherwise.
        <p className="mono text-[11px] text-ink-3">
          {meta.diagramType}
          {meta.template ? ` · ${meta.template}` : ""} · {meta.model} · attempt{" "}
          {meta.attempts}
          {meta.repaired ? " · repaired" : ""}
          {meta.fellBack ? " · FELL BACK to generic" : ""}
          {meta.truncated ? " · truncated (model ran out of time)" : ""}
        </p>
      )}
    </main>
  );
}
