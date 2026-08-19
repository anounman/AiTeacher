"use client";

import { useCallback, useEffect, useState } from "react";
import { extractNativeArtifactEntries } from "@/lib/artifacts/entries";
import type { NativeArtifact } from "@/lib/artifacts/schema";
import type { NativeArtifactVersionOverride } from "@/components/artifacts/NativeArtifact";
import type { Conversation, Message } from "@/lib/db/schema";

// Active native-artifact version overrides for the loaded messages, extracted
// from app/(app)/page.tsx. Owns: the override map keyed by stable entry id
// (`${messageId}:artifact:${ordinal}`), the load effect that fetches
// GET /api/artifacts/[id] for every native fence in the messages, and the
// change/error handlers the in-artifact version menu calls. Threaded through
// ChatMessage → Markdown → NativeArtifact so an edited version replaces the
// immutable parsed payload for its fence only.
//
// `MessageLike` is the page's `MessageWithSources` shape — we only read
// `id`, `role`, `kind`, `content` here, so a structural type keeps the hook
// decoupled from the page's full message type.
type MessageLike = Pick<Message, "id" | "role" | "kind" | "content">;

type VersionHistoryEntry = {
  id: string;
  instruction: string | null;
  active: boolean;
  created_at: number;
};

type ArtifactApiResponse = {
  active: { payload: NativeArtifact; versionId: string | null };
  history: VersionHistoryEntry[];
};

export function useArtifactVersions(
  conversation: Conversation | null,
  messages: MessageLike[],
  onError: (message: string) => void,
) {
  const [overrides, setOverrides] = useState<Record<string, NativeArtifactVersionOverride>>({});

  // Load active versions + history for every native artifact fence in the
  // loaded messages. Only registers an override when a saved version exists —
  // otherwise the renderer uses the immutable payload and shows no version
  // menu. Re-fires on conversation/message change; the page clears overrides
  // on conversation switch (see resetForNewConversation).
  useEffect(() => {
    if (!conversation) return;
    const entries: { artifactId: string }[] = [];
    for (const m of messages) {
      if (m.role !== "assistant" || m.kind === "document" || !m.content) continue;
      for (const entry of extractNativeArtifactEntries(m.id, m.content)) {
        entries.push({ artifactId: entry.id });
      }
    }
    if (entries.length === 0) return;
    let cancelled = false;
    void Promise.all(
      entries.map(async ({ artifactId }) => {
        try {
          const res = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`);
          if (!res.ok) return null;
          const data = (await res.json()) as ArtifactApiResponse;
          if (!data.active.versionId) return null;
          return {
            artifactId,
            override: {
              versionId: data.active.versionId,
              artifact: data.active.payload,
              history: data.history,
            } satisfies NativeArtifactVersionOverride,
          };
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, NativeArtifactVersionOverride> = {};
      for (const r of results) {
        if (r) next[r.artifactId] = r.override;
      }
      if (Object.keys(next).length > 0) setOverrides(next);
    });
    return () => {
      cancelled = true;
    };
  }, [conversation, messages]);

  // Apply a successful transform/restore: update the override for this entry
  // id, then refresh its history from the server so the version list stays in
  // sync (a transform creates a new version; a restore flips activation).
  const handleVersionChange = useCallback(
    async (
      entryId: string,
      result: { versionId: string; artifact: NativeArtifact },
    ) => {
      setOverrides((prev) => {
        const existing = prev[entryId];
        return {
          ...prev,
          [entryId]: {
            versionId: result.versionId,
            artifact: result.artifact,
            history: existing?.history ?? [],
          },
        };
      });
      try {
        const res = await fetch(`/api/artifacts/${encodeURIComponent(entryId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { history: VersionHistoryEntry[] };
        setOverrides((prev) => {
          const current = prev[entryId];
          if (!current) return prev;
          return { ...prev, [entryId]: { ...current, history: data.history } };
        });
      } catch {
        // History refresh is best-effort; the active override already updated.
      }
    },
    [],
  );

  const handleError = useCallback((message: string) => {
    onError(message);
  }, [onError]);

  // The page calls this when switching conversations to clear stale overrides.
  const resetForNewConversation = useCallback(() => {
    setOverrides({});
  }, []);

  return {
    overrides,
    handleVersionChange,
    handleError,
    resetForNewConversation,
  };
}