"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useMotion, fadeUp } from "@/lib/motion";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { Band } from "@/lib/mastery/model";

// The per-concept mastery list, extracted from the old /mastery page so the
// Map (/graph) page can render it as a list/graph toggle without carrying the
// row markup. Renders the band-count summary badges + the <ul> of concept
// rows (label, band badge, reviewed/total cards, last-reviewed date) and the
// loading / empty / error states exactly as the old page did.

export type Row = {
  id: string;
  label: string;
  mastery: number | null;
  band: Band;
  reviewedCards: number;
  totalCards: number;
  lastReviewed: number | null;
};

// Band → Badge tone. `unknown` falls through to `untested` (matches the old
// mastery page's bandTone).
export function bandTone(band: Band): "slipping" | "strong" | "learning" | "untested" {
  if (band === "slipping") return "slipping";
  if (band === "strong") return "strong";
  if (band === "learning") return "learning";
  return "untested";
}

export function MasteryList({
  rows,
  loading,
  loadError,
}: {
  rows: Row[] | null;
  loading: boolean;
  loadError?: string | null;
}) {
  const m = useMotion();

  const counts = (rows ?? []).reduce(
    (a, r) => ({ ...a, [r.band]: a[r.band] + 1 }),
    { slipping: 0, learning: 0, strong: 0, untested: 0, unknown: 0 } as Record<Band, number>,
  );

  return (
    <div>
      {/* Band-count summary — parity with the old Mastery page header. */}
      {rows && rows.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <Badge tone="slipping">{counts.slipping} slipping</Badge>
          <Badge tone="learning">{counts.learning} learning</Badge>
          <Badge tone="strong">{counts.strong} strong</Badge>
        </div>
      )}

      {loading ? (
        <p className="mono py-10 text-center text-[12px] text-content-faint">loading mastery…</p>
      ) : loadError ? (
        <p className="mono py-10 text-center text-[12px] text-danger">{loadError}</p>
      ) : !rows || rows.length === 0 ? (
        <div className="mono py-10 text-center text-[12px] text-content-faint">
          no concepts yet —{" "}
          <Link href="/projects" className="text-content-muted underline">build a concept graph first</Link>
        </div>
      ) : (
        <ul className="space-y-1 overflow-x-auto">
          {rows.map((r) => (
            <motion.li key={r.id} {...m} variants={fadeUp}>
              <Card className="mono flex items-center justify-between gap-3 px-3 py-2 text-[12px]">
                <span className="min-w-0 truncate text-ink">{r.label}</span>
                <span className="flex shrink-0 items-center gap-3 tabular-nums text-content-faint">
                  <Badge tone={bandTone(r.band)}>{r.band}</Badge>
                  <span className="hidden sm:inline">{r.reviewedCards}/{r.totalCards} cards</span>
                  {r.lastReviewed && <span className="hidden md:inline">last {new Date(r.lastReviewed).toLocaleDateString()}</span>}
                </span>
              </Card>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}