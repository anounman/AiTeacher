"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { P5Write } from "@/components/visual/P5Write";
import { markupToTex } from "@/lib/teach/markup-to-tex";

// The writer bake-off: the same content drawn by all three candidates, side
// by side, so the judgement is made by looking rather than by argument.
//
//   mathwriter — the incumbent: harvested-glyph handwriting (PNG raster)
//   Manim      — typeset LaTeX written on stroke-by-stroke (video clip)
//   p5.js      — live canvas, handwriting font, speed adjustable WHILE writing
//
// The toggle at the bottom flips real lessons to the Manim writer
// (localStorage; HandWrite falls back to mathwriter for anything Manim
// cannot express — tables, multi-line, unknown glyphs).

const SAMPLES = [
  { label: "quadratic formula", markup: "x = [F]-b ± [R]b² - 4ac[/R]|2a[/F]" },
  { label: "heading", markup: "~~The Quadratic Formula~~" },
  { label: "sum", markup: "[S]k=0|n[/S] k² = [F]n(n+1)(2n+1)|6[/F]" },
  { label: "prose note", markup: "the discriminant decides how many roots exist" },
];

function MathwriterCell({ markup }: { markup: string }) {
  const [png, setPng] = useState<string | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    const started = performance.now();
    fetch("/api/handwrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markup, color: "#1f2020", scale: 1.0 }),
    })
      .then(async (res) => (res.ok ? ((await res.json()) as { png?: string }) : null))
      .then((data) => {
        if (data?.png) {
          setPng(`data:image/png;base64,${data.png}`);
          setMs(Math.round(performance.now() - started));
        }
      })
      .catch(() => {});
  }, [markup]);
  if (!png) return <p className="mono text-[11px] text-ink-3">rendering…</p>;
  return (
    <div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={png} alt={markup} className="handwrite-ink-raster" style={{ maxWidth: "100%" }} />
      {ms !== null && <p className="mono mt-1 text-[10px] text-ink-3">{ms}ms</p>}
    </div>
  );
}

function ManimCell({ markup }: { markup: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const spec = markupToTex(markup);
    if (!spec) {
      setError("not expressible — would fall back to mathwriter");
      return;
    }
    const started = performance.now();
    const body = spec.heading
      ? { kind: "write_text", text: spec.tex, heading: true, seconds: 1.8 }
      : { kind: "write_math", tex: spec.tex, seconds: 2.5 };
    fetch("/api/teach/clip-render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    })
      .then(async (res) => (res.ok ? ((await res.json()) as { id?: string }) : null))
      .then((data) => {
        if (data?.id) {
          setSrc(`/api/teach/clip/${data.id}`);
          setMs(Math.round(performance.now() - started));
        } else setError("render failed");
      })
      .catch(() => setError("render failed"));
  }, [markup]);
  if (error) return <p className="mono text-[11px] text-feynman">{error}</p>;
  if (!src) return <p className="mono text-[11px] text-ink-3">rendering…</p>;
  return (
    <div>
      <video src={src} muted playsInline autoPlay loop className="handwrite-ink-raster" style={{ maxWidth: "100%", borderRadius: 2 }} />
      {ms !== null && <p className="mono mt-1 text-[10px] text-ink-3">{ms}ms (then cached forever)</p>}
    </div>
  );
}

function P5Cell({ markup }: { markup: string }) {
  const [speed, setSpeed] = useState(1);
  const [generation, setGeneration] = useState(0);
  const heading = /^~~.*~~$/.test(markup.trim());
  const text = markup.replace(/~~/g, "").replace(/\[\/?[A-Z]\]/g, " ").replace(/\|/g, "/");
  return (
    <div>
      <P5Write key={generation} text={text} heading={heading} speed={speed} />
      <div className="mono mt-1 flex items-center gap-2 text-[10px] text-ink-3">
        <span>speed×{speed.toFixed(1)} (live)</span>
        <input
          type="range"
          min={0.2}
          max={3}
          step={0.1}
          value={speed}
          onChange={(event) => setSpeed(Number(event.target.value))}
        />
        <button type="button" className="underline" onClick={() => setGeneration((g) => g + 1)}>
          replay
        </button>
      </div>
    </div>
  );
}

export default function WriterLab() {
  const [writer, setWriter] = useState<string>("mathwriter");
  useEffect(() => {
    setWriter(localStorage.getItem("aiteacher.writer") ?? "mathwriter");
  }, []);
  const toggle = useCallback(() => {
    const next = writer === "manim" ? "mathwriter" : "manim";
    localStorage.setItem("aiteacher.writer", next);
    setWriter(next);
  }, [writer]);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl" style={{ fontFamily: "var(--font-serif)" }}>
          Writer lab
        </h1>
        <Link href="/" className="mono text-[11px] text-ink-3 hover:text-ink">
          ← back
        </Link>
      </header>

      <p className="max-w-3xl text-ink-2">
        The same content drawn by all three writers. mathwriter is what lessons use today; Manim
        is typeset LaTeX writing itself on; p5 is a live canvas whose speed you can drag{" "}
        <em>while it writes</em> — the one thing a rendered clip cannot do.
      </p>

      <div className="grid grid-cols-[120px_1fr_1fr_1fr] items-start gap-4">
        <div />
        <h2 className="mono text-[12px] text-ink-3">mathwriter (current)</h2>
        <h2 className="mono text-[12px] text-ink-3">Manim (typeset, video)</h2>
        <h2 className="mono text-[12px] text-ink-3">p5.js (live canvas)</h2>
        {SAMPLES.map((sample) => (
          <div key={sample.label} className="contents">
            <p className="mono pt-2 text-[11px] text-ink-3">{sample.label}</p>
            <div className="rounded-lg border border-line bg-paper-2 p-3">
              <MathwriterCell markup={sample.markup} />
            </div>
            <div className="rounded-lg border border-line bg-paper-2 p-3">
              <ManimCell markup={sample.markup} />
            </div>
            <div className="rounded-lg border border-line bg-paper-2 p-3">
              <P5Cell markup={sample.markup} />
            </div>
          </div>
        ))}
      </div>

      <section className="flex flex-col gap-2 rounded-xl border border-line bg-paper-2 p-4">
        <p className="text-ink-2">
          Lesson writer on this device: <strong className="text-ink">{writer}</strong>
        </p>
        <p className="mono text-[11px] text-ink-3">
          With Manim on, teach-mode equations and headings render as typeset write-on clips.
          Tables, multi-line items, and anything not faithfully expressible stay with mathwriter
          automatically.
        </p>
        <button
          type="button"
          onClick={toggle}
          className="w-fit rounded-lg border border-line px-4 py-2 text-ink transition-colors hover:bg-paper-3"
        >
          Switch lessons to {writer === "manim" ? "mathwriter" : "Manim"}
        </button>
      </section>
    </main>
  );
}
