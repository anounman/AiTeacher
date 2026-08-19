"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SourceEntry } from "@/lib/db/schema";
import { consumeSse } from "@/lib/chat/sse";
import type { SelectionSnapshot } from "@/components/chat/selection";

export type EphemeralTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  status?: string;
  statusLabel?: string;
};

export function useEphemeralChat(snapshot: SelectionSnapshot | null, conversationId: string | null, web: boolean) {
  const [turns, setTurns] = useState<EphemeralTurn[]>([]);
  const [sources, setSources] = useState<SourceEntry[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const turnsRef = useRef<EphemeralTurn[]>([]);

  const setTurnState = useCallback((next: EphemeralTurn[] | ((current: EphemeralTurn[]) => EphemeralTurn[])) => {
    setTurns((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      turnsRef.current = resolved;
      return resolved;
    });
  }, []);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    runIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    turnsRef.current = [];
    setTurns([]);
    setSources([]);
    setError(null);
    setStreaming(false);
  }, []);

  useEffect(() => () => {
    controllerRef.current?.abort();
  }, []);

  const send = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question || !snapshot || !conversationId || streaming) return;
    const runId = ++runIdRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setStreaming(true);
    const userTurn: EphemeralTurn = { id: crypto.randomUUID(), role: "user", content: question };
    const assistantTurn: EphemeralTurn = { id: crypto.randomUUID(), role: "assistant", content: "", status: "thinking" };
    const history = [...turnsRef.current, userTurn];
    setTurnState([...history, assistantTurn]);
    let reasoning = "";
    let content = "";

    try {
      const response = await fetch("/api/chat/overlay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          sourceMessageId: snapshot.sourceMessageId,
          selectedText: snapshot.selectedText,
          messages: history.map(({ role, content: turnContent }) => ({ role, content: turnContent })),
          web,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error((await response.text()) || `Request failed (${response.status})`);
      await consumeSse(response, {
        onEvent: (event) => {
          if (runId !== runIdRef.current) return;
          if (event.type === "sources") setSources(event.sources);
          if (event.type === "text") content += event.delta;
          if (event.type === "reasoning") reasoning += event.delta;
          if (event.type === "text" || event.type === "reasoning" || event.type === "status") {
            setTurnState((current) => current.map((turn) => turn.id === assistantTurn.id
              ? {
                  ...turn,
                  content,
                  reasoning: reasoning || undefined,
                  status: event.type === "status" ? event.phase : "writing",
                  statusLabel: event.type === "status" ? event.label : undefined,
                }
              : turn));
          }
        },
      }, controller.signal);
    } catch (caught) {
      if (!controller.signal.aborted && runId === runIdRef.current) {
        setError(caught instanceof Error ? caught.message : "Something went wrong");
      }
    } finally {
      if (runId === runIdRef.current) {
        setStreaming(false);
        controllerRef.current = null;
        setTurnState((current) => current.map((turn) => turn.id === assistantTurn.id ? { ...turn, status: undefined } : turn));
      }
    }
  }, [conversationId, setTurnState, snapshot, streaming, web]);

  return { turns, sources, streaming, error, send, stop, clear };
}
