import type { MessageActivity, MessageGrounding, SourceEntry } from "@/lib/db/schema";

export type AnswerActivity = MessageActivity;
export type AnswerGrounding = Omit<MessageGrounding, "model">;

export function createAnswerInsightCollector() {
  const activities: AnswerActivity[] = [];
  const materialIds: string[] = [];
  let sourceCount = 0;
  let usedWeb = false;
  let usedNotation = false;

  return {
    recordStatus(phase: string, label?: string): AnswerActivity | null {
      const text = label?.trim();
      if (!text || activities.at(-1)?.label === text) return null;
      const activity = { phase, label: text, ordinal: activities.length };
      activities.push(activity);
      return activity;
    },
    recordSources(sources: SourceEntry[]) {
      sourceCount = sources.length;
      for (const source of sources) {
        if (!materialIds.includes(source.materialId)) materialIds.push(source.materialId);
      }
    },
    markWebUsed() {
      usedWeb = true;
    },
    markNotationUsed() {
      usedNotation = true;
    },
    activities(): AnswerActivity[] {
      return activities;
    },
    grounding(): AnswerGrounding {
      return { materialIds, sourceCount, usedNotation, usedWeb };
    },
  };
}
