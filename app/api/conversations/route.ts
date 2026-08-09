import { NextResponse } from "next/server";
import { createConversation, listConversations } from "@/lib/db";
import { getModelConfig } from "@/lib/llm/provider";

// GET /api/conversations — list all, newest first.
export async function GET() {
  return NextResponse.json(listConversations());
}

// POST /api/conversations — create a new conversation.
// Body: { title?, mode? }  (model defaults to the live settings model)
export async function POST(req: Request) {
  const { title, mode, projectId } = await req.json().catch(() => ({}));
  const cfg = getModelConfig();
  const conv = createConversation({
    title: title || "New conversation",
    mode: mode === "feynman" ? "feynman" : "chat",
    model: cfg.model,
    projectId: typeof projectId === "string" ? projectId : null,
  });
  return NextResponse.json(conv, { status: 201 });
}