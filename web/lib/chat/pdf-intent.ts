// Heuristic: does this user message ask the app to produce a downloadable,
// printable document (a PDF)?
//
// The app can turn a response into a one-click downloadable PDF, but only when
// the turn is sent as a "document" turn (kind='document' → the document card
// with a download-PDF button). Without this detection, a plain-chat request
// like "make a cheat sheet for my exam, 4 pages A4" stays in chat mode — and
// the model, seeing the artifact rules in the chat prompt, emits a full HTML
// `artifact` (a sandboxed iframe with "Open in new tab") instead of a markdown
// document the app can print. The user then has to leave chat to "download" it.
//
// sendMessage() uses this to auto-flip the turn into document mode so the model
// authors a markdown document and the download-PDF button appears, with no
// manual toggle. Two families of signals:
//
//   1. Explicit PDF/export phrasing ("make a PDF", "pdf of X", "export as PDF").
//   2. Document-format / printable-artifact phrasing that implies a paginated,
//      downloadable document even without the word "PDF": "cheat sheet",
//      "study guide", "4 pages", "A4", "printable", "make a document/guide".
//
// Conservative on the format family — we only match concrete document shapes
// (cheat sheet, one-pager, study guide, handout, N pages, A4, printable), not
// generic verbs like "summarize" or "explain", so a normal study question stays
// a chat reply. Rare false positives just author a document about that topic —
// harmless and self-correcting.

const PDF_EXPORT_RE = /\b(?:make|create|generate|give|export|download|save|print|send|turn)\b[\s\w]{0,40}\bpdf\b/i;
const PDF_OF_RE = /\bpdf\b[\s\w]{0,20}\b(?:of|with|for|on|about)\b/i;
const AS_PDF_RE = /\b(?:export|save|download|print|convert|turn)\b[\s\w]{0,30}\b(?:as|to|into)\s+(?:a\s+)?pdf\b/i;

// Document-format nouns: a named printable artifact. "cheat sheet", "study
// guide", "one-pager", "handout", "fact sheet", "reference sheet", "cram
// sheet", "revision notes".
const DOC_FORMAT_RE = /\b(?:cheat ?sheets?|one[- ]pagers?|fact sheets?|reference sheets?|cram sheets?|study guides?|handouts?|revision notes)\b/i;

// Pagination signals: "4 pages", "two-page", "3 page". A number/word-number
// directly before "page(s)" is a strong "I want a paginated document" signal.
const PAGES_RE = /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*[- ]?pages?\b/i;

// Paper-size / print-readiness signals. "A4", "letter size(d)", "printable",
// "print-ready".
const PRINT_RE = /\b(?:A4|letter[- ]sized?|printable|print[- ]ready)\b/i;

// "make/create/write me a document/guide/handout". The noun is a concrete
// document type (not "summary"/"notes", which are too broad and would fire on
// every "summarize this" / "take notes").
const MAKE_DOC_RE = /\b(?:make|create|write|generate|give|put together|produce|draft)\b[\s\w]{0,30}\b(?:documents?|guide|handouts?)\b/i;

export function looksLikePdfExport(text: string): boolean {
  return (
    PDF_EXPORT_RE.test(text) ||
    PDF_OF_RE.test(text) ||
    AS_PDF_RE.test(text) ||
    DOC_FORMAT_RE.test(text) ||
    PAGES_RE.test(text) ||
    PRINT_RE.test(text) ||
    MAKE_DOC_RE.test(text)
  );
}