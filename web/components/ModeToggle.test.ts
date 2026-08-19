import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(process.cwd(), "components/ModeToggle.tsx"), "utf8");

test("mode selection moves one active surface between Chat and Feynman", () => {
  assert.match(source, /motion\.span/);
  assert.match(source, /layoutId="active-mode-indicator"/);
  assert.match(source, /useLayoutMotion/);
});
