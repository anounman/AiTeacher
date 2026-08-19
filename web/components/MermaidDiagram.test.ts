import assert from "node:assert/strict";
import test from "node:test";
import * as MermaidDiagramModule from "./MermaidDiagram";

const errorSvg = `
  <svg aria-roledescription="error" role="graphics-document document">
    <text>Syntax error in text</text>
    <text>mermaid version 11.16.1</text>
  </svg>
`;

const validSvg = `<svg aria-roledescription="flowchart"><g class="nodes" /></svg>`;

test("uses strict security and platform visual tokens", () => {
  const config = (
    MermaidDiagramModule as typeof MermaidDiagramModule & {
      MERMAID_CONFIG?: { securityLevel?: string; fontFamily?: string; themeCSS?: string };
    }
  ).MERMAID_CONFIG;

  assert.equal(config?.securityLevel, "strict");
  assert.equal(config?.fontFamily, "var(--font-sans)");
  assert.match(config?.themeCSS ?? "", /var\(--surface\)/);
  assert.match(config?.themeCSS ?? "", /var\(--content\)/);
  assert.match(config?.themeCSS ?? "", /var\(--border\)/);
  assert.match(config?.themeCSS ?? "", /foreignObject/);
  assert.match(config?.themeCSS ?? "", /!important/);
});

test("recognizes Mermaid error SVGs before they reach the chat", () => {
  const isMermaidErrorSvg = (
    MermaidDiagramModule as typeof MermaidDiagramModule & {
      isMermaidErrorSvg?: (svg: string) => boolean;
    }
  ).isMermaidErrorSvg;

  assert.equal(typeof isMermaidErrorSvg, "function");
  assert.equal(isMermaidErrorSvg?.(errorSvg), true);
  assert.equal(isMermaidErrorSvg?.(validSvg), false);
});
