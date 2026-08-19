"use client";

import { Check, Copy, Maximize2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { artifactKindLabel, type NativeArtifactKind } from "@/lib/artifacts/schema";
import { Card } from "@/components/ui/Card";
import { IconButton } from "@/components/ui/IconButton";

interface ArtifactFrameProps {
  kind: NativeArtifactKind;
  title?: string;
  summary?: string;
  source?: string;
  onFocus?: () => void;
  children: ReactNode;
}

export async function copyArtifactSource(source: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(source);
    return true;
  } catch {
    return false;
  }
}

export function ArtifactFrame({ kind, title, summary, source, onFocus, children }: ArtifactFrameProps) {
  const [copied, setCopied] = useState(false);

  async function copySource() {
    if (!source || !await copyArtifactSource(source)) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Card className="animate-in fade-in-0 motion-reduce:animate-none my-3 max-w-full overflow-hidden border-border/70 bg-surface-2 shadow-card duration-150">
      <div className="flex items-start gap-3 border-b border-border/70 bg-surface/60 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="mono text-[10px] font-medium tracking-[0.12em] text-content-faint">
            {artifactKindLabel(kind)}
          </div>
          {title && <h3 className="mt-1 font-serif text-[1.05rem] font-semibold leading-tight text-ink">{title}</h3>}
          {summary && <p className="mt-1 text-[12px] leading-relaxed text-content-muted">{summary}</p>}
        </div>
        {(source || onFocus) && (
          <div className="flex shrink-0 items-center gap-1">
            {source && (
              <IconButton label={copied ? "Copied artifact" : "Copy artifact"} size="sm" onClick={copySource}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </IconButton>
            )}
            {onFocus && (
              <IconButton label="Focus artifact" size="sm" onClick={onFocus}>
                <Maximize2 size={14} />
              </IconButton>
            )}
          </div>
        )}
      </div>
      <div className="px-4 py-3">{children}</div>
    </Card>
  );
}
