import { db } from "./index";
import type { SourceEntry } from "./schema";

export function setMessageSources(messageId: string, sources: SourceEntry[]): void {
  db.prepare(
    "INSERT INTO message_sources (message_id, sources, created_at) VALUES (?, ?, ?) ON CONFLICT(message_id) DO UPDATE SET sources = excluded.sources",
  ).run(messageId, JSON.stringify(sources), Date.now());
}

export function getMessageSources(messageId: string): SourceEntry[] {
  const row = db.prepare("SELECT sources FROM message_sources WHERE message_id = ?").get(messageId) as
    | { sources: string }
    | undefined;
  if (!row) return [];
  try {
    return JSON.parse(row.sources) as SourceEntry[];
  } catch {
    return [];
  }
}