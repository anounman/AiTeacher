"use client";

import { useEffect, useState } from "react";
import type { SourceEntry } from "@/lib/db/schema";
import type { Band } from "@/lib/mastery/model";

function bandText(band: Band): string {
  switch (band) {
    case "slipping":
      return "text-rule";
    case "strong":
      return "text-feynman";
    case "learning":
      return "text-ink";
    default:
      return "text-ink-3";
  }
}

export function SourcesPanel({
  sources,
  allMaterials,
}: {
  sources: SourceEntry[];
  allMaterials?: { id: string; title: string }[];
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const reveal = (event: Event) => {
      const sourceId = (event as CustomEvent<string>).detail;
      if (!sources.some((source) => source.sourceId === sourceId)) return;
      setOpen(true);
      requestAnimationFrame(() => {
        document.getElementById(`source-${sourceId}`)?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "nearest",
        });
      });
    };
    window.addEventListener("open-source", reveal);
    return () => window.removeEventListener("open-source", reveal);
  }, [sources]);

  const hasMaterials = !!allMaterials && allMaterials.length > 0;
  if (!sources.length && !hasMaterials) return null;

  // When the parent threads the active project's materials, show every
  // material and mark which ones contributed chunks to this answer. This is
  // the "the model knows about all your materials" view; the per-source
  // snippets still appear underneath each used material when expanded.
  if (hasMaterials) {
    const usedByMaterial = new Map<string, SourceEntry[]>();
    for (const s of sources) {
      const list = usedByMaterial.get(s.materialId);
      if (list) list.push(s);
      else usedByMaterial.set(s.materialId, [s]);
    }
    const usedCount = usedByMaterial.size;
    return (
      <div className="mt-3 border-t border-line pt-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="mono flex items-center gap-1.5 text-[10px] tracking-wide text-ink-3 transition-colors hover:text-ink"
        >
          <span className="h-1 w-1 rounded-full bg-feynman" />
          {usedCount} / {allMaterials!.length} material{allMaterials!.length === 1 ? "" : "s"}
          <span className="text-ink-3">{open ? "▾" : "▸"}</span>
        </button>
        {open && (
          <ul className="mt-2 flex flex-col gap-2">
            {allMaterials!.map((m) => {
              const used = usedByMaterial.get(m.id) ?? [];
              const isUsed = used.length > 0;
              return (
                <li
                  key={m.id}
                  className="rounded-[2px] bg-paper-3/60 px-2.5 py-2"
                >
                  <div className="mono flex items-center gap-1.5 text-[10px] tracking-wide">
                    <span
                      className={
                        isUsed
                          ? "inline-block h-1.5 w-1.5 rounded-full bg-feynman"
                          : "inline-block h-1.5 w-1.5 rounded-full border border-ink-3"
                      }
                    />
                    <span className={isUsed ? "text-feynman" : "text-ink-3"}>
                      {m.title}
                    </span>
                    {isUsed && (
                      <span className="text-ink-3">· {used.length} excerpt{used.length === 1 ? "" : "s"}</span>
                    )}
                  </div>
                  {isUsed && (
                    <ul className="mt-1.5 flex flex-col gap-1.5 pl-3">
                      {used.map((s, i) => (
                        <li
                          key={`${s.materialId}-${s.ordinal}-${i}`}
                          id={`source-${s.sourceId}`}
                          className="border-l border-line pl-2"
                        >
                          <p className="mono mb-0.5 text-[9px] tracking-wide text-feynman">
                            source {i + 1}{s.page ? ` · page ${s.page}` : ` · excerpt ${s.ordinal + 1}`}
                          </p>
                          <p className="text-[12px] leading-relaxed text-ink-2 line-clamp-3">
                            “{s.snippet}”
                          </p>
                          {s.concepts && s.concepts.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {s.concepts.map((c, i) => (
                                <span key={i} className={`mono text-[10px] tracking-wide ${bandText(c.band)}`}>
                                  {c.label} · {c.band}
                                </span>
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  // Fallback: only injected sources are known (parent hasn't wired materials
  // yet). Show the original snippet list.
  return (
    <div className="mt-3 border-t border-line pt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="mono flex items-center gap-1.5 text-[10px] tracking-wide text-ink-3 transition-colors hover:text-ink"
      >
        <span className="h-1 w-1 rounded-full bg-feynman" />
        {sources.length} source{sources.length === 1 ? "" : "s"}
        <span className="text-ink-3">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul className="mt-2 flex flex-col gap-2">
          {sources.map((s, i) => (
            <li id={`source-${s.sourceId}`} key={`${s.materialId}-${s.ordinal}-${i}`} className="rounded-[2px] bg-paper-3/60 px-2.5 py-2">
              <p className="mono text-[10px] tracking-wide text-feynman">
                {s.title}{s.page ? ` · page ${s.page}` : ` · excerpt ${s.ordinal + 1}`}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-2 line-clamp-3">“{s.snippet}”</p>
              {s.concepts && s.concepts.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {s.concepts.map((c, i) => (
                    <span key={i} className={`mono text-[10px] tracking-wide ${bandText(c.band)}`}>
                      {c.label} · {c.band}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
