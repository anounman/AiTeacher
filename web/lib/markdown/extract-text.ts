import type { ReactNode } from "react";

// Recursively flatten a react-markdown <pre><code>…</code></pre> tree to its
// raw text — used to copy code, and to read an artifact's HTML source out of
// a fenced block. Handles strings, numbers, arrays, and React element trees.
export function extractText(node: ReactNode): string {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    return extractText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}