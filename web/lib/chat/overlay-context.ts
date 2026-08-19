export const MAX_SELECTED_TEXT_CHARS = 4_000;

export type OverlayContextTurn = {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
};

export type OverlayModelTurn = Pick<OverlayContextTurn, "role" | "content">;

export function normalizeSelectedText(text: string): string | null {
  const normalized = text.trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_SELECTED_TEXT_CHARS);
}

export function createSelectionFocusMessage(selectedText: string): OverlayModelTurn {
  return {
    role: "user",
    content: `Selected passage from the answer being discussed:\n<selected_text>\n${selectedText}\n</selected_text>`,
  };
}

function sizeOf(turn: OverlayContextTurn): number {
  return turn.content.length;
}

function toModelTurn(turn: OverlayContextTurn): OverlayModelTurn {
  return { role: turn.role, content: turn.content };
}

export function buildOverlayHistory(
  prefix: OverlayContextTurn[],
  sourceMessageId: string,
  overlayTurns: OverlayModelTurn[],
  maxChars: number,
): OverlayModelTurn[] {
  const sourceIndex = prefix.findIndex((turn) => turn.id === sourceMessageId && turn.role === "assistant");
  if (sourceIndex < 0) return [];

  const sourceAnswer = prefix[sourceIndex];
  const sourceUserIndex = prefix.slice(0, sourceIndex).map((turn) => turn.role).lastIndexOf("user");
  const sourceUser = sourceUserIndex >= 0 ? prefix[sourceUserIndex] : null;

  const keptMain: OverlayContextTurn[] = sourceUser ? [sourceUser, sourceAnswer] : [sourceAnswer];
  let usedChars = keptMain.reduce((total, turn) => total + sizeOf(turn), 0);

  const keptOverlay: OverlayModelTurn[] = [];
  for (let index = overlayTurns.length - 1; index >= 0; index -= 1) {
    const turn = overlayTurns[index];
    if (usedChars + sizeOf(turn) > maxChars) continue;
    keptOverlay.unshift(turn);
    usedChars += sizeOf(turn);
  }

  let index = sourceUserIndex >= 0 ? sourceUserIndex - 1 : sourceIndex - 1;
  while (index >= 1) {
    const answer = prefix[index];
    const question = prefix[index - 1];
    if (question.role !== "user" || answer.role !== "assistant") break;
    const pairSize = sizeOf(question) + sizeOf(answer);
    if (usedChars + pairSize > maxChars) break;
    keptMain.unshift(question, answer);
    usedChars += pairSize;
    index -= 2;
  }

  return [...keptMain.map(toModelTurn), ...keptOverlay];
}
