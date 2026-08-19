"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import type { SourceEntry } from "@/lib/db/schema";
import { loadEvidencePreview } from "@/lib/chat/evidence-preview";

type PreviewState = string | null | "unavailable";

export function EvidenceDialog({
  source,
  onOpenChange,
}: {
  source: SourceEntry | null;
  onOpenChange: (source: SourceEntry | null) => void;
}) {
  const [preview, setPreview] = useState<PreviewState>("unavailable");
  const page = source?.page;

  // Synchronize the preview state with the (asynchronously fetched) page image
  // for the current source. setState in the body is intentional: the preview is
  // derived from an external fetch whose result lands after mount, so it cannot
  // be computed during render. Mirrors the established pattern in
  // app/(app)/page.tsx (see the search/concept-loading effects).
  useEffect(() => {
    if (!source || typeof page !== "number" || !Number.isInteger(page) || page <= 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreview("unavailable");
      return;
    }

    let active = true;
    let imageUrl: string | null = null;
    setPreview(null);
    void loadEvidencePreview(
      `/api/materials/${encodeURIComponent(source.materialId)}/evidence?page=${page}`,
      {
        fetchPreview: (url) => fetch(url),
        createObjectURL: (blob) => URL.createObjectURL(blob),
        revokeObjectURL: (url) => URL.revokeObjectURL(url),
        isActive: () => active,
      },
      (url) => {
        imageUrl = url;
        setPreview(url);
      },
    )
      .then((loaded) => {
        if (active && !loaded) setPreview("unavailable");
      })
      .catch(() => {
        if (active) setPreview("unavailable");
      });

    return () => {
      active = false;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [page, source]);

  return (
    <Dialog open={!!source} onOpenChange={(open) => !open && onOpenChange(null)}>
      <DialogContent
        showClose={false}
        className="flex h-[min(88dvh,56rem)] w-[min(96vw,64rem)] max-w-none flex-col overflow-hidden"
      >
        {source && (
          <>
            <DialogHeader className="flex shrink-0 items-start gap-4 border-b border-border px-6 py-4">
              <div className="min-w-0">
                <DialogTitle className="truncate pr-8">{source.title}</DialogTitle>
                <DialogDescription>{Number.isInteger(page) && page! > 0 ? `Page ${page}` : "Source passage"}</DialogDescription>
              </div>
              <DialogClose
                aria-label="Close source evidence"
                className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-content-faint transition-colors hover:bg-surface-2 hover:text-content focus-visible:ring-2 focus-visible:ring-ring outline-none"
              >
                <X size={16} />
              </DialogClose>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-thin">
              {preview && preview !== "unavailable" && (
                <img src={preview} alt={`Page preview from ${source.title}`} className="mb-5 w-full rounded-card border border-border" />
              )}
              {preview === null && <p className="mono mb-5 text-[11px] text-content-faint">Loading page preview…</p>}
              {preview === "unavailable" && (
                <p className="mono mb-5 text-[11px] text-content-faint">Page preview is not available for this source.</p>
              )}
              <p className="eyebrow">Passage</p>
              <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-content">{source.snippet}</p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
