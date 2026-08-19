"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight } from "lucide-react";
import type { SourceEntry } from "@/lib/db/schema";
import type { Band } from "@/lib/mastery/model";
import { Badge } from "@/components/ui/Badge";
import { useMotion, fadeUp, fastTransition } from "@/lib/motion";
import { cn } from "@/lib/cn";

function bandTone(band: Band): "slipping" | "strong" | "learning" | "untested" {
  if (band === "slipping") return "slipping";
  if (band === "strong") return "strong";
  if (band === "learning") return "learning";
  return "untested";
}

export function SourcesPanel({
  sources,
  allMaterials,
}: {
  sources: SourceEntry[];
  allMaterials?: { id: string; title: string }[];
}) {
  const [open, setOpen] = useState(false);
  const m = useMotion();

  const hasMaterials = !!allMaterials && allMaterials.length > 0;
  if (!sources.length && !hasMaterials) return null;

  const chevron = (
    <motion.span
      animate={{ rotate: open ? 90 : 0 }}
      transition={fastTransition}
      className="text-content-faint"
    >
      <ChevronRight size={11} strokeWidth={2} />
    </motion.span>
  );

  // When the parent threads the active project's materials, show every material
  // and mark which ones contributed chunks to this answer. The per-source
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
      <div className="mt-4">
        <button
          onClick={() => setOpen((o) => !o)}
          className="mono flex items-center gap-1.5 text-[10px] tracking-wide text-content-faint transition-colors hover:text-content"
        >
          <span className="h-1 w-1 rounded-full bg-feynman" />
          {usedCount} / {allMaterials!.length} material{allMaterials!.length === 1 ? "" : "s"}
          {chevron}
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.ul
              {...m}
              variants={fadeUp}
              className="mt-2 flex flex-col gap-2 overflow-hidden"
            >
              {allMaterials!.map((mat) => {
                const used = usedByMaterial.get(mat.id) ?? [];
                const isUsed = used.length > 0;
                return (
                  <li key={mat.id} className="rounded-[3px] bg-surface-2/60 px-2.5 py-2">
                    <div className="mono flex items-center gap-1.5 text-[10px] tracking-wide">
                      <span
                        className={cn(
                          "inline-block h-1.5 w-1.5 rounded-full",
                          isUsed ? "bg-feynman" : "border border-content-faint",
                        )}
                      />
                      <span className={isUsed ? "text-content-muted" : "text-content-faint"}>
                        {mat.title}
                      </span>
                      {isUsed && (
                        <span className="text-content-faint">
                          · {used.length} excerpt{used.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                    {isUsed && (
                      <ul className="mt-1.5 flex flex-col gap-1.5 pl-3">
                        {used.map((s, i) => (
                          <li key={`${s.materialId}-${s.ordinal}-${i}`} className="border-l border-border pl-2">
                            <p className="text-[12px] leading-relaxed text-content-muted line-clamp-3">
                              “{s.snippet}”
                            </p>
                            {s.concepts && s.concepts.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                {s.concepts.map((c, i) => (
                                  <Badge key={i} tone={bandTone(c.band)}>
                                    {c.label} · {c.band}
                                  </Badge>
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
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Fallback: only injected sources are known (parent hasn't wired materials
  // yet). Show the original snippet list.
  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="mono flex items-center gap-1.5 text-[10px] tracking-wide text-content-faint transition-colors hover:text-content"
      >
        <span className="h-1 w-1 rounded-full bg-feynman" />
        {sources.length} source{sources.length === 1 ? "" : "s"}
        {chevron}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul {...m} variants={fadeUp} className="mt-2 flex flex-col gap-2 overflow-hidden">
            {sources.map((s, i) => (
              <li key={`${s.materialId}-${s.ordinal}-${i}`} className="rounded-card border border-border bg-surface-2/60 px-3 py-2.5 shadow-sm">
                <p className="mono text-[10px] tracking-wide text-content-muted">{s.title}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-content-muted line-clamp-3">
                  “{s.snippet}”
                </p>
                {s.concepts && s.concepts.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {s.concepts.map((c, i) => (
                      <Badge key={i} tone={bandTone(c.band)}>
                        {c.label} · {c.band}
                      </Badge>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
