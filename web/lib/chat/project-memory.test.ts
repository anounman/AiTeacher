import assert from "node:assert/strict";
import { test } from "node:test";
import { buildProjectMemoryBlock, type ProjectMemory } from "./project-memory";

test("buildProjectMemoryBlock keeps active, non-blank entries in input order", () => {
  const entries: ProjectMemory[] = [
    { content: "Use Chen notation for ER models.", active: true },
    { content: "Ignore this preference.", active: false },
    { content: "   ", active: true },
    { content: "Prefer step-by-step derivations.", active: true },
  ];

  const block = buildProjectMemoryBlock(entries);

  assert.match(block, /Project memory/);
  assert.match(block, /Use Chen notation for ER models\./);
  assert.match(block, /Prefer step-by-step derivations\./);
  assert.doesNotMatch(block, /Ignore this preference/);
  assert.ok(
    block.indexOf("Use Chen notation") < block.indexOf("Prefer step-by-step"),
  );
});

test("buildProjectMemoryBlock returns an empty block when nothing is usable", () => {
  assert.equal(buildProjectMemoryBlock([]), "");
  assert.equal(
    buildProjectMemoryBlock([
      { content: "", active: true },
      { content: "Hidden", active: false },
    ]),
    "",
  );
});

test("buildProjectMemoryBlock gives the assistant clear private-use instructions", () => {
  const block = buildProjectMemoryBlock([
    { content: "The course calls precedence graphs conflict graphs.", active: true },
  ]);

  assert.match(block, /Use this only to tailor responses/i);
  assert.match(block, /Do not mention this memory/i);
});

test("buildProjectMemoryBlock stays within its 1200-character prompt budget", () => {
  const entries: ProjectMemory[] = Array.from({ length: 20 }, (_, index) => ({
    content: `Preference ${index}: ${"x".repeat(200)}`,
    active: true,
  }));

  const block = buildProjectMemoryBlock(entries);

  assert.ok(block.length <= 1200, `block length was ${block.length}`);
  assert.match(block, /Preference 0/);
});
