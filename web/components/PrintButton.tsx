"use client";

// Triggers the browser's print dialog (→ Save as PDF). `no-print` keeps it
// off the printed page itself.
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print mono rounded-[3px] bg-ink px-4 py-1.5 text-[12px] tracking-wide text-paper-2 transition-opacity hover:opacity-90"
    >
      print / save as PDF ⌘P
    </button>
  );
}