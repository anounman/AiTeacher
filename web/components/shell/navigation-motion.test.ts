import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const sidebar = readFileSync(resolve(process.cwd(), "components/shell/Sidebar.tsx"), "utf8");
const bottomNav = readFileSync(resolve(process.cwd(), "components/shell/BottomTabBar.tsx"), "utf8");
const conversations = readFileSync(resolve(process.cwd(), "components/shell/ConversationListPane.tsx"), "utf8");
const chatPage = readFileSync(resolve(process.cwd(), "app/(app)/page.tsx"), "utf8");

test("navigation carries the active marker between destinations", () => {
  assert.match(sidebar, /motion\.span/);
  assert.match(sidebar, /layoutId="active-sidebar-indicator"/);
  assert.match(bottomNav, /motion\.span/);
  assert.match(bottomNav, /layoutId="active-bottom-tab-indicator"/);
});

test("conversation and chat rows preserve their position during updates", () => {
  assert.match(conversations, /motion\.div/);
  assert.match(conversations, /layout="position"/);
  assert.match(chatPage, /<motion\.div[\s\S]*?key=\{m\.id\}[\s\S]*?layout=\{!streaming\}/);
});

test("layout animations honor the shared reduced-motion setting", () => {
  assert.match(sidebar, /useLayoutMotion/);
  assert.match(bottomNav, /useLayoutMotion/);
  assert.match(conversations, /useLayoutMotion/);
});
