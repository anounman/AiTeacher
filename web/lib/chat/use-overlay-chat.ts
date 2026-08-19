"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OverlayMessage, OverlayThread, SourceEntry } from "@/lib/db/schema";
import { consumeSse } from "@/lib/chat/sse";

export type OverlayTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  sources: SourceEntry[];
  status?: string;
  statusLabel?: string;
};

function asTurn(message: OverlayMessage): OverlayTurn {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    reasoning: message.reasoning ?? undefined,
    sources: message.sources,
  };
}

export function useOverlayChat(
  thread: OverlayThread,
  initialMessages: OverlayMessage[],
  web: boolean,
) {
  const [turns, setTurns] = useState<OverlayTurn[]>(() => initialMessages.map(asTurn));
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const turnsRef = useRef<OverlayTurn[]>(initialMessages.map(asTurn));

  const setTurnState = useCallback((next: OverlayTurn[] | ((current: OverlayTurn[]) => OverlayTurn[])) => {
    setTurns((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      turnsRef.current = resolved;
      return resolved;
    });
  }, []);

  useEffect(() => {
    controllerRef.current?.abort();
    const resolved = initialMessages.map(asTurn);
    runIdRef.current += 1;
    turnsRef.current = resolved;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTurns(resolved);
    setError(null);
    setStreaming(false);
  }, [initialMessages, thread.id]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const stop = useCallback(() => controllerRef.current?.abort(), []);

  const send = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question || streaming) return;
    const runId = ++runIdRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setStreaming(true);
    const userTurn: OverlayTurn = { id: crypto.randomUUID(), role: "user", content: question, sources: [] };
    const assistantTurn: OverlayTurn = { id: crypto.randomUUID(), role: "assistant", content: "", sources: [], status: "thinking" };
    setTurnState([...turnsRef.current, userTurn, assistantTurn]);
    let content = "";
    let reasoning = "";
    let sources: SourceEntry[] = [];

    try {
      const response = await fetch("/api/chat/overlay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overlayId: thread.id, question, web }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error((await response.text()) || `Request failed (${response.status})`);
      await consumeSse(response, {
        onEvent: (event) => {
          if (runId !== runIdRef.current) return;
          if (event.type === "text") content += event.delta;
          if (event.type === "reasoning") reasoning += event.delta;
          if (event.type === "sources") sources = event.sources;
          if (event.type === "text" || event.type === "reasoning" || event.type === "sources" || event.type === "status") {
            setTurnState((current) => current.map((turn) => turn.id === assistantTurn.id
              ? {
                  ...turn,
                  content,
                  reasoning: reasoning || undefined,
                  sources,
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
  }, [setTurnState, streaming, thread.id, web]);

  return { turns, streaming, error, send, stop };
}
