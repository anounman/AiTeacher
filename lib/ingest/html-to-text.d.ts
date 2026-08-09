// Minimal ambient types for `html-to-text` v10, which ships no .d.ts files.
// Only the surface used by lib/ingest is typed; the rest is intentionally loose.

interface HtmlToTextSelector {
  selector: string;
  format?: string;
  options?: Record<string, unknown>;
}

interface HtmlToTextOptions {
  wordwrap?: number | false;
  selectors?: HtmlToTextSelector[];
  [key: string]: unknown;
}

declare module "html-to-text" {
  export function convert(html: string, options?: HtmlToTextOptions): string;
  export function compile(
    options?: HtmlToTextOptions,
  ): (html: string, metadata?: unknown) => string;
  const _default: { convert: typeof convert; compile: typeof compile };
  export default _default;
}