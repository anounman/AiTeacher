import { NextResponse } from "next/server";
import { getMessageSources, getMessage, getConversation } from "@/lib/db";

// GET /api/messages/[id] — the message's content + kind + sources (+ the
// conversation title). The chat's Sources panel consumes `sources`; the
// /print/[id] page consumes `content` + `kind` to render the document. Sources
// are keyed by message id, so no conversation lookup is needed for them.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const msg = getMessage(id);
  if (!msg) return new Response("Not found", { status: 404 });
  const conv = getConversation(msg.conversation_id);
  return NextResponse.json({
    content: msg.content,
    kind: msg.kind,
    conversationTitle: conv?.title ?? null,
    sources: getMessageSources(id),
  });
}