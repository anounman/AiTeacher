import { db } from "./index";
import type { OverlayMessage, OverlayThread, SourceEntry } from "./schema";

type RawOverlayMessage = Omit<OverlayMessage, "sources"> & { sources: string | null };

function parseSources(serialized: string | null): SourceEntry[] {
  if (!serialized) return [];
  try {
    const parsed = JSON.parse(serialized);
    return Array.isArray(parsed) ? parsed as SourceEntry[] : [];
  } catch {
    return [];
  }
}

export function resolveOverlayThread(
  conversationId: string,
  sourceMessageId: string,
  selectedText: string,
  textOffset: number,
): { thread: OverlayThread; created: boolean } {
  const existing = db.prepare(
    "SELECT * FROM overlay_threads WHERE conversation_id = ? AND source_message_id = ? AND selected_text = ? AND text_offset = ?",
  ).get(conversationId, sourceMessageId, selectedText, textOffset) as OverlayThread | undefined;
  if (existing) return { thread: existing, created: false };

  const now = Date.now();
  const thread: OverlayThread = {
    id: crypto.randomUUID(),
    conversation_id: conversationId,
    source_message_id: sourceMessageId,
    selected_text: selectedText,
    text_offset: textOffset,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO overlay_threads
      (id, conversation_id, source_message_id, selected_text, text_offset, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    thread.id,
    thread.conversation_id,
    thread.source_message_id,
    thread.selected_text,
    thread.text_offset,
    thread.created_at,
    thread.updated_at,
  );
  return { thread, created: true };
}

export function getOverlayThread(id: string): OverlayThread | null {
  return db.prepare("SELECT * FROM overlay_threads WHERE id = ?").get(id) as OverlayThread | null;
}

export function listOverlayThreads(conversationId: string): OverlayThread[] {
  return db.prepare(
    "SELECT * FROM overlay_threads WHERE conversation_id = ? ORDER BY updated_at DESC, rowid DESC",
  ).all(conversationId) as OverlayThread[];
}

export function listOverlayMessages(overlayId: string): OverlayMessage[] {
  const rows = db.prepare(
    "SELECT * FROM overlay_messages WHERE overlay_id = ? ORDER BY created_at ASC, rowid ASC",
  ).all(overlayId) as RawOverlayMessage[];
  return rows.map((row) => ({ ...row, sources: parseSources(row.sources) }));
}

export function addOverlayMessage(
  overlayId: string,
  role: OverlayMessage["role"],
  content: string,
  options?: Pick<OverlayMessage, "reasoning" | "sources">,
): OverlayMessage {
  const row: OverlayMessage = {
    id: crypto.randomUUID(),
    overlay_id: overlayId,
    role,
    content,
    reasoning: options?.reasoning ?? null,
    sources: options?.sources ?? [],
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO overlay_messages (id, overlay_id, role, content, reasoning, sources, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.overlay_id, row.role, row.content, row.reasoning, JSON.stringify(row.sources), row.created_at);
  db.prepare("UPDATE overlay_threads SET updated_at = ? WHERE id = ?").run(row.created_at, overlayId);
  return row;
}
