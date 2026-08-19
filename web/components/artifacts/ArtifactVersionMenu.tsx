"use client";

import { useState } from "react";
import { History, Pencil, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import type { NativeArtifact } from "@/lib/artifacts/schema";

// Fixed transform actions offered on every native artifact. The id is stable
// for analytics/disable-state; the prompt is the instruction sent to the
// transform route. `Turn into flashcards` changes representation (the model
// may switch the kind) — that's an explicit, allowed instruction.
export const FIXED_TRANSFORM_ACTIONS = [
  { id: "simplify", label: "Simplify", prompt: "Simplify this artifact: keep the same meaning but make it clearer and shorter." },
  { id: "add-example", label: "Add example", prompt: "Add a concrete worked example to this artifact without losing the existing content." },
  { id: "turn-into-flashcards", label: "Turn into flashcards", prompt: "Turn this artifact into a flashcard-style study set, keeping the same topic and key facts." },
] as const;

export type ArtifactHistoryEntry = {
  id: string;
  instruction: string | null;
  active: boolean;
  created_at: number;
};

type TransformResult = { versionId: string; artifact: NativeArtifact };

export function ArtifactVersionMenu({
  artifactId,
  legacy,
  history,
  activeVersionId,
  onVersionChange,
  onError,
}: {
  artifactId: string;
  legacy: boolean;
  history: ArtifactHistoryEntry[];
  activeVersionId?: string | null;
  // Notified after a successful transform OR restore so the parent can update
  // the active-version override it threads back into Markdown → NativeArtifact.
  onVersionChange: (result: TransformResult) => void;
  // Notified when a transform/restore fails so the parent can surface a toast.
  // The menu also keeps an inline retry affordance.
  onError?: (message: string) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [pending, setPending] = useState<string | null>(null); // action id/instruction being run
  const [error, setError] = useState<string | null>(null);

  if (legacy) {
    return (
      <p className="mono mt-2 text-[11px] leading-relaxed text-content-faint">
        Legacy visualizations cannot be safely edited in place.
      </p>
    );
  }

  async function runTransform(prompt: string, key: string) {
    setPending(key);
    setError(null);
    try {
      const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/transform`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifactId, instruction: prompt }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Transform failed");
      }
      const result = (await response.json()) as TransformResult;
      onVersionChange(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Transform failed";
      // Preserve the current artifact on error — the parent does not clear the
      // override, so the last successful version stays rendered. Show retry.
      setError(message);
      onError?.(message);
    } finally {
      setPending(null);
    }
  }

  async function restore(versionId: string) {
    setPending(`restore:${versionId}`);
    setError(null);
    try {
      const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Restore failed");
      }
      const result = (await response.json()) as TransformResult;
      onVersionChange(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Restore failed";
      setError(message);
      onError?.(message);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {FIXED_TRANSFORM_ACTIONS.map((action) => (
          <Button
            key={action.id}
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending !== null}
            onClick={() => void runTransform(action.prompt, action.id)}
            className="mono text-[11px]"
          >
            {action.label}
          </Button>
        ))}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Custom edit…"
            aria-label="Custom artifact edit instruction"
            className="h-8 w-40 rounded-control border border-border bg-surface px-2.5 text-[12px] text-content outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
          />
          <IconButton
            label="Apply edit"
            size="sm"
            disabled={pending !== null || instruction.trim().length === 0}
            onClick={() => {
              const prompt = instruction.trim();
              if (prompt) void runTransform(prompt, `custom:${prompt}`);
            }}
          >
            <Pencil size={13} />
          </IconButton>
        </div>
      </div>

      {pending && (
        <p className="mono mt-2 flex items-center gap-1.5 text-[11px] text-content-faint">
          <RefreshCw size={12} className="animate-spin" />
          Updating artifact…
        </p>
      )}
      {error && !pending && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-rule">
          <span className="truncate">{error}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => setError(null)} className="mono">
            Retry
          </Button>
        </div>
      )}

      {history.length > 0 && (
        <details className="mt-2">
          <summary className="mono flex cursor-pointer items-center gap-1.5 text-[11px] text-content-faint">
            <History size={12} />
            Version history ({history.length})
          </summary>
          <ol className="mt-2 space-y-1">
            {history.map((version, index) => (
              <li key={version.id} className="flex items-center gap-2 text-[11px]">
                <span className="text-content-faint">Version {history.length - index}</span>
                <span className="truncate text-content-muted">
                  {version.instruction ?? "Original"}
                </span>
                {version.active ? (
                  <span className="mono ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-content-faint">
                    Active
                  </span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending !== null}
                    onClick={() => void restore(version.id)}
                    className="mono ml-auto text-[11px]"
                    aria-label={`Restore version ${history.length - index}`}
                  >
                    <RefreshCw size={11} />
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
      {/* Keep activeVersionId referenced so the parent can force a re-render
          of the menu when the active version changes externally. */}
      {activeVersionId ? null : null}
    </div>
  );
}