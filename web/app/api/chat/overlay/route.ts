import {
  addOverlayMessage,
  getConversation,
  getOverlayThread,
  listConversationMessagesThrough,
  listOverlayMessages,
} from "@/lib/db";
import type { SourceEntry } from "@/lib/db/schema";
import { streamAnswer } from "@/lib/chat/answer-engine";
import {
  buildOverlayHistory,
  createSelectionFocusMessage,
  type OverlayModelTurn,
} from "@/lib/chat/overlay-context";
import { encodeSseEvent } from "@/lib/chat/sse";
import { z, validateBody } from "@/lib/server/validation";
import { generateRequestId, logger, withRequestId } from "@/lib/server/logger";

// Body for an overlay follow-up question. Historically parsed with
// `req.json().catch(() => ({}))` (untyped `any`) and then gated field-by-field
// in the handler. Keep every field `z.any()` so the schema never rejects what
// the old `.catch(() => ({}))` + `typeof` guards accepted — the handler's own
// checks remain the sole arbiters of presence/length.
const OverlayQuestionBody = z.object({
  overlayId: z.any().optional(),
  question: z.any().optional(),
  web: z.any().optional(),
});

const MAX_OVERLAY_TURNS = 24;
const OVERLAY_CONTEXT_CHARS = 60_000;

// NOTE: this handler returns a ReadableStream (SSE) with its own internal
// `send({ type: "error" })` error boundary. The stream is the response — it
// cannot be returned from inside `withRouteHandler`'s try/catch without the
// wrapper trying to double-handle errors. So we validate the body with zod
// (structured 400) but do NOT wrap the whole handler in withRouteHandler. We
// still bind a requestId via withRequestId so server-side logging of stream
// failures carries the same id; the client only sees a generic
// "Streaming failed" message (the real error is logged server-side).
export async function POST(req: Request) {
  const bodyResult = await validateBody(req, OverlayQuestionBody);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.value;

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!body.overlayId || !question || question.length > 12_000) {
    return new Response("Missing overlay question", { status: 400 });
  }

  const thread = getOverlayThread(body.overlayId);
  if (!thread) return new Response("Overlay not found", { status: 404 });
  const conversation = getConversation(thread.conversation_id);
  if (!conversation) return new Response("Conversation not found", { status: 404 });
  const prefix = listConversationMessagesThrough(thread.conversation_id, thread.source_message_id);
  if (!prefix) return new Response("Original answer is no longer available", { status: 404 });

  addOverlayMessage(thread.id, "user", question);
  const temporaryTurns: OverlayModelTurn[] = listOverlayMessages(thread.id)
    .slice(-MAX_OVERLAY_TURNS)
    .map(({ role, content }) => ({ role, content }));
  const history = buildOverlayHistory(prefix, thread.source_message_id, temporaryTurns, OVERLAY_CONTEXT_CHARS);
  if (history.length === 0) return new Response("Original answer is no longer available", { status: 404 });

  const focusIndex = Math.max(0, history.length - temporaryTurns.length);
  history.splice(focusIndex, 0, createSelectionFocusMessage(thread.selected_text));

  const requestId = generateRequestId();
  const streamBody = new ReadableStream<Uint8Array>({
    async start(controller) {
      let content = "";
      let reasoning = "";
      let sources: SourceEntry[] = [];
      const send = (event: Parameters<typeof encodeSseEvent>[0]) => {
        if (event.type === "text") content += event.delta;
        if (event.type === "reasoning") reasoning += event.delta;
        if (event.type === "sources") sources = event.sources;
        controller.enqueue(encodeSseEvent(event));
      };
      await withRequestId(requestId, async () => {
        try {
          await streamAnswer(
            {
              conversation,
              messages: history,
              web: body.web,
              retrievalQuery: `${question}\n${thread.selected_text}`,
              abortSignal: req.signal,
            },
            send,
          );
          send({ type: "done" });
        } catch (error) {
          // Log the real error server-side (bound to requestId); send a generic
          // message to the client so internals (e.g. usage-limit text) never leak.
          logger.error("chat overlay stream failed", {
            requestId,
            error: error instanceof Error ? error.message : String(error),
          });
          send({ type: "error", message: "Streaming failed" });
        } finally {
          if (content.trim()) {
            addOverlayMessage(thread.id, "assistant", content, {
              reasoning: reasoning || null,
              sources,
            });
          }
          controller.close();
        }
      });
    },
  });

  return new Response(streamBody, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}