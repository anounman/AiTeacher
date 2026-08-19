export type DeliveryState = "complete" | "interrupted";

export function interruptedReplyLabel(content: string): string | null {
  return content.trim() ? "Response interrupted — retry to continue." : null;
}
