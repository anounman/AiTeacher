import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StudyActions } from "./StudyActions";
import type { StudyAction } from "@/lib/chat/study-actions";

const actions: StudyAction[] = [
  { id: "explain-formula", label: "Explain this formula", prompt: "Explain the formula: x", selectedText: "x" },
  { id: "quiz-me", label: "Quiz me on this", prompt: "Quiz me on: y", selectedText: "y" },
];

test("renders one accessible chip per action with its label", () => {
  const markup = renderToStaticMarkup(
    <StudyActions messageId="m1" actions={actions} onSelect={() => {}} />,
  );
  assert.match(markup, /Explain this formula/);
  assert.match(markup, /Quiz me on this/);
  // Each chip is a button reachable by keyboard.
  assert.match(markup, /<button/g);
});

test("renders no chips when the actions list is empty", () => {
  const markup = renderToStaticMarkup(
    <StudyActions messageId="m1" actions={[]} onSelect={() => {}} />,
  );
  assert.equal(markup.trim(), "");
});

test("renders at most two chips", () => {
  const three: StudyAction[] = [
    { id: "explain-formula", label: "A", prompt: "p1", selectedText: "x" },
    { id: "worked-example", label: "B", prompt: "p2", selectedText: "x" },
    { id: "quiz-me", label: "C", prompt: "p3", selectedText: "y" },
  ];
  const markup = renderToStaticMarkup(
    <StudyActions messageId="m1" actions={three} onSelect={() => {}} />,
  );
  const chipCount = (markup.match(/<button/g) ?? []).length;
  // 2 action chips + 1 dismiss control = 3 buttons max.
  assert.ok(chipCount <= 3, `expected at most 3 buttons, got ${chipCount}`);
  assert.match(markup, /A/);
  assert.match(markup, /B/);
});

test("renders nothing when already dismissed for that message (sessionStorage stub)", () => {
  const store = new Map<string, string>();
  const sessionStorageStub = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
  // Replace the global for this test only (Node has no sessionStorage by default).
  (globalThis as { sessionStorage?: Storage }).sessionStorage = sessionStorageStub as unknown as Storage;
  store.set("studygpt:study-actions:m1", "1");
  const markup = renderToStaticMarkup(
    <StudyActions messageId="m1" actions={actions} onSelect={() => {}} />,
  );
  assert.equal(markup.trim(), "");
  // Restore by deletion so later tests aren't affected.
  delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
});