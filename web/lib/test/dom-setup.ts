// DOM test environment setup for component tests run under `node --import tsx
// --test`. Registers a happy-dom Window as the global `window`/`document`/
// `navigator`/`HTMLElement` etc. BEFORE @testing-library/react is imported by
// any test file (testing-library captures `document` at import time from its
// own module scope, so the globals must exist first).
//
// Load this with `--import ./lib/test/dom-setup.ts` (tsx resolves .ts). It is a
// no-op in non-test contexts — only act when a happy-dom Window can be created
// and no document exists yet.

try {
  if (typeof globalThis.document === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Window } = require("happy-dom") as typeof import("happy-dom");
    const window = new Window();
    globalThis.window = window as unknown as Window & typeof globalThis;
    globalThis.document = window.document as unknown as Document;
    if (!globalThis.navigator) {
      Object.defineProperty(globalThis, "navigator", {
        value: window.navigator,
        configurable: true,
        writable: true,
      });
    }
    // React DOM rendering also reaches for these; provide them from happy-dom.
    if (typeof globalThis.HTMLElement === "undefined") {
      (globalThis as unknown as Record<string, unknown>).HTMLElement =
        window.HTMLElement as unknown as typeof HTMLElement;
    }
    if (typeof globalThis.Event === "undefined") {
      (globalThis as unknown as Record<string, unknown>).Event = window.Event as unknown as typeof Event;
    }
    // testing-library's cleanupBetweenTests hooks into afterEach via a test
    // runner adapter; node:test has no such hook, so auto-cleanup is a no-op.
    // Tests call `cleanup()` explicitly where needed.
  }
} catch {
  // If happy-dom isn't resolvable (e.g. production install), do nothing —
  // component tests that need a DOM will fail loudly, which is correct.
}