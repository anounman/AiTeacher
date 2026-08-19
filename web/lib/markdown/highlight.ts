import type { Options } from "rehype-pretty-code";

// Shiki syntax-highlighting config for the shared Markdown pipeline. Shiki
// tokenizes with VS Code TextMate grammars and emits inline-styled <span>s, so
// code blocks get real syntax colors (keywords, strings, types, …) instead of
// plain monospace. Wired as a rehype plugin in components/Markdown.tsx.
//
// Dual theme: Shiki sets each token to the light theme's color inline plus a
// `--shiki-dark` custom property. globals.css swaps to the dark palette under
// `html[data-theme="dark"]` (the app's theme attribute), so token colors track
// the theme toggle without a re-highlight.
//
// keepBackground:false drops Shiki's own <pre> background so the existing
// `.prose-chat pre` chrome (bg-paper-3, border, padding, overflow-x) stays the
// code block's look — Shiki only paints the token spans. defaultLang makes a
// fence with no language highlight as plaintext (no tokens, no label).
export const codeHighlightOptions: Options = {
  theme: { light: "github-light", dark: "github-dark" },
  keepBackground: false,
  defaultLang: "plaintext",
};