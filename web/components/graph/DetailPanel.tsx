"use client";

import { useEffect, useState } from "react";
import type { ConceptDetail } from "@/lib/db";

interface DetailPanelProps {
  conceptId: string | null;
  clusterName: string | null;
  onSelectConcept: (id: string) => void;
}

export function DetailPanel({ conceptId, clusterName, onSelectConcept }: DetailPanelProps) {
  const [detail, setDetail] = useState<ConceptDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!conceptId) {
      return;
    }
    let alive = true;
    // Fetch-on-select: marking loading + clearing stale error before the
    // async call is the canonical pattern; the synchronous setState here is
    // intentional. The last-good `detail` is intentionally kept so the panel
    // can render a dimmed body during refetch / on fetch failure.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fetch(`/api/concepts/${encodeURIComponent(conceptId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("not-found");
        return (await r.json()) as ConceptDetail;
      })
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setLoading(false);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setLoading(false);
        setError(err instanceof Error && err.message === "not-found" ? "Concept not found" : "Could not load concept");
      });
    return () => {
      alive = false;
    };
  }, [conceptId]);

  // Shared detail body JSX — reused by the normal, dimmed-error, and
  // dimmed-loading render paths so the markup exists once.
  const detailBody = detail ? (
    <div className="flex flex-col gap-3 rounded-[3px] border border-line bg-paper-2 p-4">
      <div>
        <div className="text-[15px] text-ink">{detail.concept.label}</div>
        {clusterName && <div className="mono mt-0.5 text-[10px] text-ink-3">{clusterName}</div>}
      </div>
      <div className="mono text-[10px] text-ink-3">
        {detail.concept.sourceCount} source{detail.concept.sourceCount === 1 ? "" : "s"}
      </div>
      {detail.concept.description && (
        <p className="text-[12px] leading-relaxed text-ink-2">{detail.concept.description}</p>
      )}

      <div>
        <div className="mono mb-1 text-[10px] tracking-wide text-ink-3">PROVENANCE</div>
        {detail.sources.length === 0 ? (
          <div className="mono text-[10px] text-ink-3">none</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.sources.map((s, i) => (
              <li key={i} className="mono text-[10px] text-ink-2">
                <span className="text-ink">{s.title}</span>{" "}
                <span className="text-ink-3">· chunk {s.ordinal}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mono mb-1 text-[10px] tracking-wide text-ink-3">NEIGHBORS</div>
        {detail.neighbors.length === 0 ? (
          <div className="mono text-[10px] text-ink-3">none</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.neighbors.map((n, i) => (
              <li key={i}>
                <button
                  onClick={() => onSelectConcept(n.id)}
                  className="mono w-full truncate text-left text-[10px] text-ink-2 hover:text-ink"
                  title={`${n.relation} · ${n.confidence}`}
                >
                  <span className="text-ink-3">{n.direction === "out" ? "→" : "←"} </span>
                  <span className="text-ink">{n.label}</span>{" "}
                  <span className="text-ink-3">{n.relation}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  ) : null;

  if (!conceptId) {
    return (
      <div className="mono rounded-[3px] border border-line bg-paper-2 p-4 text-[12px] text-ink-3">
        select a concept to see its description, provenance, and neighbors.
      </div>
    );
  }
  // Fetch failure with last-good state: show a small error line above the
  // dimmed prior detail body (spec: keeps last good state dimmed).
  if (error && detail) {
    return (
      <div className="flex flex-col gap-2">
        <div className="mono text-[10px] text-rule">{error}</div>
        <div className="opacity-40">{detailBody}</div>
      </div>
    );
  }
  // Fetch failure with no prior state: bare error block.
  if (error && !detail) {
    return (
      <div className="mono rounded-[3px] border border-line bg-paper-2 p-4 text-[12px] text-rule">
        {error}
      </div>
    );
  }
  // Refetching with last-good state: dim the prior body + small loading line.
  if (loading && detail) {
    return (
      <div className="flex flex-col gap-2">
        <div className="mono text-[10px] text-ink-3">loading…</div>
        <div className="opacity-40">{detailBody}</div>
      </div>
    );
  }
  // First load with no prior state: standalone loading block.
  if (loading && !detail) {
    return (
      <div className="mono rounded-[3px] border border-line bg-paper-2 p-4 text-[12px] text-ink-3">
        loading…
      </div>
    );
  }
  // Normal: freshly loaded detail body.
  return detailBody;
}