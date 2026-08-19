import { db } from "./index";
import type { MessageActivity, MessageGrounding } from "./schema";

export type MessageInsights = {
  activities: MessageActivity[];
  grounding: MessageGrounding | null;
};

export function setMessageInsights(
  messageId: string,
  activities: MessageActivity[],
  grounding: MessageGrounding,
): void {
  const now = Date.now();
  db.transaction(() => {
    db.prepare("DELETE FROM message_activities WHERE message_id = ?").run(messageId);
    const addActivity = db.prepare(
      "INSERT INTO message_activities (message_id, ordinal, phase, label, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    for (const activity of activities) {
      addActivity.run(messageId, activity.ordinal, activity.phase, activity.label, now);
    }
    db.prepare(
      `INSERT INTO message_grounding (message_id, material_ids, source_count, used_web, used_notation, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(message_id) DO UPDATE SET
         material_ids = excluded.material_ids,
         source_count = excluded.source_count,
         used_web = excluded.used_web,
         used_notation = excluded.used_notation,
         model = excluded.model,
         created_at = excluded.created_at`,
    ).run(
      messageId,
      JSON.stringify(grounding.materialIds),
      grounding.sourceCount,
      Number(grounding.usedWeb),
      Number(grounding.usedNotation),
      grounding.model,
      now,
    );
  })();
}

export function getMessageInsights(messageId: string): MessageInsights {
  const activities = db
    .prepare("SELECT phase, label, ordinal FROM message_activities WHERE message_id = ? ORDER BY ordinal ASC")
    .all(messageId) as MessageActivity[];
  const row = db.prepare(
    "SELECT material_ids, source_count, used_web, used_notation, model FROM message_grounding WHERE message_id = ?",
  ).get(messageId) as {
    material_ids: string;
    source_count: number;
    used_web: number;
    used_notation: number;
    model: string | null;
  } | undefined;
  if (!row) return { activities, grounding: null };

  let materialIds: string[] = [];
  try {
    const parsed = JSON.parse(row.material_ids);
    if (Array.isArray(parsed)) materialIds = parsed.filter((value): value is string => typeof value === "string");
  } catch {
    materialIds = [];
  }
  return {
    activities,
    grounding: {
      materialIds,
      sourceCount: row.source_count,
      usedWeb: Boolean(row.used_web),
      usedNotation: Boolean(row.used_notation),
      model: row.model,
    },
  };
}
