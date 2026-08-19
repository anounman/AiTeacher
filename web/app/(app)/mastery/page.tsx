"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Project } from "@/lib/db/schema";
import type { Band } from "@/lib/mastery/model";

type Row = {
  id: string;
  label: string;
  mastery: number | null;
  band: Band;
  reviewedCards: number;
  totalCards: number;
  lastReviewed: number | null;
};

function bandText(band: Band): string {
  switch (band) {
    case "slipping": return "text-rule";
    case "strong": return "text-feynman";
    case "learning": return "text-ink";
    default: return "text-ink-3";
  }
}

export default function MasteryPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : []))
      .then((ps: Project[]) => setProjects(Array.isArray(ps) ? ps : []))
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("projectId");
    // One-shot read of an external system into state on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q) setProjectId(q);
  }, []);

  useEffect(() => {
    // Fetch-on-mount / on-projectId-change is the legitimate data-loading pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!projectId) { setRows(null); return; }
    setLoading(true);
    setLoadError(null);
    fetch(`/api/mastery?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { rows: Row[] }) => setRows(d.rows))
      .catch(() => setLoadError("Could not load mastery"))
      .finally(() => setLoading(false));
  }, [projectId]);

  const counts = (rows ?? []).reduce(
    (a, r) => ({ ...a, [r.band]: a[r.band] + 1 }),
    { slipping: 0, learning: 0, strong: 0, untested: 0, unknown: 0 } as Record<Band, number>,
  );

  return (
    <div className="graph-paper page-scroll">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="mono text-[12px] tracking-wide text-ink-3 transition-colors hover:text-ink">
            ← Back to chat
          </Link>
          <span className="mono flex items-center gap-2 text-[13px] font-medium tracking-wide text-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-feynman" />
            Mastery
          </span>
        </div>

        <h1 className="mb-6 text-[1.6rem] leading-tight text-ink">Mastery</h1>

        <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-line pb-4">
          <select
            value={projectId ?? ""}
            onChange={(e) => setProjectId(e.target.value || null)}
            className="mono rounded-[3px] border border-line bg-paper px-2 py-1.5 text-[12px] text-ink outline-none focus:border-ink/40"
          >
            <option value="">choose a project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {rows && rows.length > 0 && (
            <span className="mono text-[11px] tabular-nums text-ink-3">
              {counts.slipping} slipping · {counts.learning} learning · {counts.strong} strong
            </span>
          )}
        </div>

        {!projectId ? (
          <p className="mono py-10 text-center text-[12px] text-ink-3">choose a project to view concept mastery</p>
        ) : loading ? (
          <p className="mono py-10 text-center text-[12px] text-ink-3">loading mastery…</p>
        ) : loadError ? (
          <p className="mono py-10 text-center text-[12px] text-rule">{loadError}</p>
        ) : !rows || rows.length === 0 ? (
          <div className="mono py-10 text-center text-[12px] text-ink-3">
            no concepts yet —{" "}
            <Link href="/projects" className="text-ink-2 underline">build a concept graph first</Link>
          </div>
        ) : (
          <ul className="space-y-1">
            {rows.map((r) => (
              <li key={r.id} className="mono flex items-center justify-between rounded-[3px] border border-line bg-paper px-3 py-2 text-[12px]">
                <span className="text-ink">{r.label}</span>
                <span className="flex items-center gap-3 tabular-nums text-ink-3">
                  <span className={bandText(r.band)}>{r.band}</span>
                  <span>{r.reviewedCards}/{r.totalCards} cards</span>
                  {r.lastReviewed && <span>last {new Date(r.lastReviewed).toLocaleDateString()}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}