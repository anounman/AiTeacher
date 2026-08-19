import type { MessageActivity, MessageGrounding, SourceEntry } from "@/lib/db/schema";

export type ChatStreamEvent =
  | { type: "status"; phase: string; label?: string }
  | { type: "activity"; activity: MessageActivity }
  | { type: "grounding"; grounding: MessageGrounding }
  | { type: "reasoning"; delta: string }
  | { type: "text"; delta: string }
  | { type: "sources"; sources: SourceEntry[] }
  | { type: "error"; message: string }
  | { type: "done" };

export function encodeSseEvent(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function consumeSse(
  response: Response,
  handlers: { onEvent?: (event: ChatStreamEvent) => void } = {},
  signal?: AbortSignal,
): Promise<void> {
  if (!response.body) throw new Error("No response stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  try {
    while (!completed) {
      if (signal?.aborted) throw new DOMException("Stream aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;

        let event: ChatStreamEvent;
        try {
          event = JSON.parse(line.slice(6)) as ChatStreamEvent;
        } catch {
          continue;
        }

        if (event.type === "error") throw new Error(event.message);
        handlers.onEvent?.(event);
        if (event.type === "done") {
          completed = true;
          break;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!completed) throw new Error("Stream ended before done");
}
