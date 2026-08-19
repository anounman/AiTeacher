import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const page = readFileSync(resolve(process.cwd(), "app/(app)/page.tsx"), "utf8");
const switcherPath = resolve(process.cwd(), "components/chat/ModelSwitcher.tsx");
const switcher = existsSync(switcherPath) ? readFileSync(switcherPath, "utf8") : "";

test("chat header uses the custom model switcher instead of a native select", () => {
  assert.match(page, /import \{ ModelSwitcher \} from "@\/components\/chat\/ModelSwitcher"/);
  assert.match(page, /<ModelSwitcher/);
  assert.doesNotMatch(page, /<select/);
});

test("model switcher shows model capabilities and the active choice", () => {
  assert.match(switcher, /AVAILABLE MODELS/);
  assert.match(switcher, /Vision ready/);
  assert.match(switcher, /Text model/);
  assert.match(switcher, /SelectItem/);
});
