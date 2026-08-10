// Where the voice actually is, as (speech event, character offset). Written
// by the performance pump's speech progress callback, read by board items
// revealing word-by-word (HandWrite). Module state for the same reason as
// performer.ts: board items poll between frames and must not re-render the
// stage to do it.

const pos = { eventIndex: -1, charIndex: 0 };

export const voiceClock = {
  reset(): void {
    pos.eventIndex = -1;
    pos.charIndex = 0;
  },
  set(eventIndex: number, charIndex: number): void {
    // Monotonic: a late timeupdate from a cancelled segment must not rewind.
    if (eventIndex < pos.eventIndex) return;
    if (eventIndex === pos.eventIndex && charIndex <= pos.charIndex) return;
    pos.eventIndex = eventIndex;
    pos.charIndex = charIndex;
  },
  reached(eventIndex: number, charIndex: number): boolean {
    return (
      pos.eventIndex > eventIndex ||
      (pos.eventIndex === eventIndex && pos.charIndex >= charIndex)
    );
  },
};
