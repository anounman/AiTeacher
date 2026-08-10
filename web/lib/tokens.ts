// Rough token estimate. There's no exact JS tokenizer for the local GLM model,
// so we approximate: CJK characters (Han, kana, Hangul) ~1 token each (they're
// dense), everything else ~4 chars/token (the common rule-of-thumb). Good
// enough for a visible usage indicator — not billing, not exact.
//
// Used to populate messages.tokens (for the global token count in Settings)
// and to show a per-message estimate in the chat header. Both use this same
// function on the same inputs, so the displayed number matches the stored one.
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (
      (c >= 0x4e00 && c <= 0x9fff) || // CJK Unified Ideographs
      (c >= 0x3040 && c <= 0x30ff) || // Hiragana + Katakana
      (c >= 0xac00 && c <= 0xd7af)   // Hangul Syllables
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  const est = Math.ceil(cjk + other / 4);
  return text.trim().length > 0 ? Math.max(1, est) : 0;
}

// The text a user turn actually contributes to the prompt: the typed content
// plus any inlined file text and OCR'd image text from its attachments. Used so
// the token count reflects what was really sent, not just what was typed.
export function userTurnText(content: string, attachments?: { type: "image" | "file"; text?: string }[] | null): string {
  if (!attachments || attachments.length === 0) return content;
  const extra = attachments
    .map((a) => (a.type === "file" ? a.text ?? "" : a.type === "image" ? a.text ?? "" : ""))
    .filter((t) => t.length > 0)
    .join("\n");
  return extra ? `${content}\n${extra}` : content;
}