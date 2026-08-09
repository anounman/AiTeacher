import { NextResponse } from "next/server";
import { getConversation, listMessages } from "@/lib/db";
import { parseTeachEvents } from "@/lib/teach/protocol";

// GET /api/teach/export?conversationId=… — the lesson's board as a real
// handwritten-notes PDF (mathwriter grid paper), importable into GoodNotes.
// Rebuilt from the lesson's write/code actions through the engine's own page
// renderer; handwriting re-warps, which is exactly what handwriting does.
// Student ink is not included (session-only until board persistence, TODO 3.2).
const SIDECAR = "http://127.0.0.1:8931/render_pdf";

export async function GET(req: Request) {
  const conversationId = new URL(req.url).searchParams.get("conversationId") ?? "";
  const conv = getConversation(conversationId);
  if (!conv) return NextResponse.json({ error: "conversation not found" }, { status: 404 });

  const parts: string[] = [];
  for (const message of listMessages(conversationId)) {
    if (message.role !== "assistant" || !message.content) continue;
    for (const event of parseTeachEvents(message.content, true)) {
      if (event.kind !== "draw") continue;
      const action = event.action;
      switch (action.type) {
        case "write":
          parts.push(action.markup);
          break;
        case "heading":
          parts.push(`~~${action.text}~~`);
          break;
        case "text":
          parts.push(action.text);
          break;
        case "code":
          // Code as handwritten lines — it is a notebook, not an IDE.
          parts.push(action.code);
          break;
        default:
          // marks/arrows/scenes annotate live geometry that does not exist on
          // a rebuilt page; new_page falls out of natural pagination.
          break;
      }
    }
  }
  const markup = parts.join("\n\n").trim();
  if (!markup) return NextResponse.json({ error: "nothing on the board yet" }, { status: 400 });

  try {
    const upstream = await fetch(SIDECAR, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markup }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      return NextResponse.json({ error: `render failed: ${detail.slice(0, 200)}` }, { status: 502 });
    }
    const pdf = await upstream.arrayBuffer();
    const name = (conv.title || "lesson").replace(/[^\w\d-]+/g, "-").slice(0, 60) || "lesson";
    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}.pdf"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "export failed (is the writer sidecar running?)" },
      { status: 502 },
    );
  }
}
