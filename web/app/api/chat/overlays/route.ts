import { NextResponse } from "next/server";
import {
  getConversation,
  listConversationMessagesThrough,
  listOverlayMessages,
  listOverlayThreads,
  resolveOverlayThread,
} from "@/lib/db";
import { normalizeSelectedText } from "@/lib/chat/overlay-context";
import { z, validateBody } from "@/lib/server/validation";
import { withRouteHandlerNoParams } from "@/lib/server/withRouteHandler";

// Body for resolving/creating a durable overlay thread. Historically parsed
// with `req.json().catch(() => ({}))` (untyped `any`) and gated field-by-field
// in the handler. Keep every field `z.any()` so the schema never rejects what
// the old `.catch(() => ({}))` + `typeof` guards accepted — the handler's own
// checks remain the sole arbiters of presence/type.
const ResolveOverlayThreadBody = z.object({
  conversationId: z.any().optional(),
  sourceMessageId: z.any().optional(),
  selectedText: z.any().optional(),
  textOffset: z.any().optional(),
});

export const GET = withRouteHandlerNoParams(async ({ request }) => {
  const conversationId = new URL(request.url).searchParams.get("conversationId");
  if (!conversationId) return NextResponse.json({ error: "Missing conversationId" }, { status: 400 });
  if (!getConversation(conversationId)) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  return NextResponse.json({ threads: listOverlayThreads(conversationId) });
});

// Resolve an existing discussion when the exact selected passage was opened
// before, or create its durable thread on first use. Source validation ensures
// a selection cannot point at a user message or another conversation.
export const POST = withRouteHandlerNoParams(async ({ request }) => {
  const bodyResult = await validateBody(request, ResolveOverlayThreadBody);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.value;

  const selectedText = typeof body.selectedText === "string" ? normalizeSelectedText(body.selectedText) : null;
  const textOffset =
    typeof body.textOffset === "number" && Number.isSafeInteger(body.textOffset) && body.textOffset >= 0
      ? body.textOffset
      : null;
  if (!body.conversationId || !body.sourceMessageId || !selectedText || textOffset === null) {
    return NextResponse.json({ error: "Missing overlay context" }, { status: 400 });
  }
  if (!getConversation(body.conversationId)) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (!listConversationMessagesThrough(body.conversationId, body.sourceMessageId)) {
    return NextResponse.json({ error: "Original answer is no longer available" }, { status: 404 });
  }

  const { thread } = resolveOverlayThread(body.conversationId, body.sourceMessageId, selectedText, textOffset);
  return NextResponse.json({ thread, messages: listOverlayMessages(thread.id) });
});