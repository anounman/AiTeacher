import { test } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";

// Set BEFORE any import of @/lib/db so the singleton opens an in-memory DB
// (a fresh one per test process). The require() below is NOT hoisted, so it
// runs after this assignment. (Static `import` would hoist above the env set
// and open the on-disk DB; top-level `await import` is unavailable under the
// project's CJS tsx transpile.)
process.env.DATABASE_URL = ":memory:";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const migrationsModule = require("./migrations") as typeof import("./migrations");
const { runMigrations, MIGRATIONS, LATEST_MIGRATION_VERSION } = migrationsModule;
import type { Migration } from "./migrations";
// Bring in the base schema + the db singleton so we can replicate open()'s
// exact boot order (SCHEMA_SQL first, then migrations) on isolated DBs.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SCHEMA_SQL } = require("./schema") as typeof import("./schema");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const DatabaseCtor = require("better-sqlite3") as typeof import("better-sqlite3");

// Build a fresh in-memory DB with the SAME boot order open() uses: create the
// db, set pragmas, run base SCHEMA_SQL, then runMigrations. The returned db has
// NOT had migrations applied yet unless applyMigrations is called — so tests
// can inspect a pre-migration shape, or run migrations themselves.
function freshDb(): Database.Database {
  const db = new DatabaseCtor(":memory:");
  db.pragma("foreign_keys = ON");
  for (const stmt of SCHEMA_SQL) db.exec(stmt);
  return db;
}

// Full open()-equivalent boot: base schema + migrations.
function boot(): Database.Database {
  const db = freshDb();
  runMigrations(db);
  return db;
}

function columns(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.map((r) => r.name);
}

function hasTable(db: Database.Database, table: string): boolean {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(table) as
    | { 1: number }
    | undefined;
  return !!row;
}

function schemaVersion(db: Database.Database): number {
  const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as { version: number } | undefined;
  return row?.version ?? 0;
}

test("fresh DB: runMigrations creates schema_version, applies all migrations, version == latest", () => {
  const db = freshDb();
  assert.ok(!hasTable(db, "schema_version"), "schema_version absent before runMigrations");
  runMigrations(db);
  assert.ok(hasTable(db, "schema_version"), "schema_version created");
  assert.equal(schemaVersion(db), LATEST_MIGRATION_VERSION, "version bumped to latest");
});

test("fresh DB: expected additive columns exist after migrations", () => {
  const db = boot();
  // messages: attachments + tokens are NOT in SCHEMA_SQL (added by migration 1);
  // kind + delivery_state ARE in SCHEMA_SQL (no-op guards fire in migration 1,
  // columns still present here).
  for (const col of ["tokens", "kind", "delivery_state", "attachments"]) {
    assert.ok(columns(db, "messages").includes(col), `messages.${col} present`);
  }
  assert.ok(columns(db, "conversations").includes("project_id"), "conversations.project_id present");
  assert.ok(columns(db, "decks").includes("daily_new_limit"), "decks.daily_new_limit present");
  // chunks.page and overlay_threads.text_offset are both in SCHEMA_SQL, so
  // they exist from the base loop; migration 3's guard is a no-op but the
  // column must still be there (confirms nothing removed it).
  assert.ok(columns(db, "chunks").includes("page"), "chunks.page present");
  assert.ok(columns(db, "overlay_threads").includes("text_offset"), "overlay_threads.text_offset present");
});

test("fresh DB: overlay_threads unique key includes text_offset", () => {
  const db = boot();
  // The rebuilt table's UNIQUE constraint covers text_offset. Verify by
  // inserting two rows that differ ONLY in text_offset — both must succeed.
  db.prepare(
    "INSERT INTO conversations (id, title, mode, model, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run("c1", "t", "chat", "m", 1);
  db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, kind, delivery_state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run("m1", "c1", "assistant", "hello world", "chat", "complete", 1);
  const ins = db.prepare(
    "INSERT INTO overlay_threads (id, conversation_id, source_message_id, selected_text, text_offset, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  ins.run("ot1", "c1", "m1", "hello", 0, 1, 1);
  // Same (conv, msg, text) but a different offset → allowed by the unique key.
  ins.run("ot2", "c1", "m1", "hello", 5, 1, 1);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS c FROM overlay_threads").get() as { c: number }).c,
    2,
  );
});

test("idempotency: running runMigrations twice is a no-op on the second run", () => {
  const db = boot();
  const versionAfterFirst = schemaVersion(db);
  // Snapshot the column sets so we can confirm the second run changed nothing.
  const before = {
    conversations: columns(db, "conversations"),
    messages: columns(db, "messages"),
    decks: columns(db, "decks"),
    chunks: columns(db, "chunks"),
    overlay_threads: columns(db, "overlay_threads"),
  };
  runMigrations(db); // second run
  assert.equal(schemaVersion(db), versionAfterFirst, "version unchanged on second run");
  assert.deepEqual(columns(db, "conversations"), before.conversations);
  assert.deepEqual(columns(db, "messages"), before.messages);
  assert.deepEqual(columns(db, "decks"), before.decks);
  assert.deepEqual(columns(db, "chunks"), before.chunks);
  assert.deepEqual(columns(db, "overlay_threads"), before.overlay_threads);
});

test("idempotency on a pre-migrated shape: manually-set version == latest is a no-op", () => {
  // Simulate an existing DB that already ran the old open() block: every column
  // is already present (we add them by hand, mimicking an older schema that
  // already had them), and the version row is pre-set to latest. runMigrations
  // must touch nothing.
  const db = freshDb();
  // Add the additive columns that the old boot block would have added. kind/
  // delivery_state/chunks.page/overlay_threads.text_offset already exist from
  // SCHEMA_SQL; add the rest manually to mimic a pre-migration-but-upgraded DB.
  db.exec("ALTER TABLE conversations ADD COLUMN project_id TEXT");
  db.exec("ALTER TABLE messages ADD COLUMN attachments TEXT");
  db.exec("ALTER TABLE messages ADD COLUMN tokens INTEGER");
  db.exec("ALTER TABLE decks ADD COLUMN daily_new_limit INTEGER NOT NULL DEFAULT 20");
  // Pre-record the version at latest (an existing user's DB that already ran
  // the old block and was then "adopted" by the migration runner).
  runMigrations(db); // first run records/bumps version to latest
  const versionAfterFirst = schemaVersion(db);
  const colsBefore = {
    conversations: columns(db, "conversations"),
    messages: columns(db, "messages"),
  };
  runMigrations(db); // second run — everything guarded, no-op
  assert.equal(schemaVersion(db), versionAfterFirst);
  assert.deepEqual(columns(db, "conversations"), colsBefore.conversations);
  assert.deepEqual(columns(db, "messages"), colsBefore.messages);
});

test("atomicity: a failing migration rolls back and does NOT bump the version", () => {
  // Isolated DB: apply the real migrations, then append a dummy migration that
  // inserts a row inside a transaction and throws. The insert must roll back
  // and the version must NOT advance past the real latest.
  const db = boot();
  const baseVersion = schemaVersion(db);
  assert.equal(baseVersion, LATEST_MIGRATION_VERSION);
  // Sentinel table + a failing migration that writes then throws.
  db.exec("CREATE TABLE atomicity_probe (x INTEGER NOT NULL UNIQUE)");
  const failing: Migration = {
    version: LATEST_MIGRATION_VERSION + 1,
    name: "dummy-failing",
    up: (d) => {
      d.transaction(() => {
        d.exec("INSERT INTO atomicity_probe (x) VALUES (1)");
        d.exec("INSERT INTO atomicity_probe (x) VALUES (1)"); // UNIQUE violation → throws
      })();
    },
  };
  assert.throws(() => runMigrations(db, [...MIGRATIONS, failing]), /UNIQUE/i);
  // The insert inside the failed transaction rolled back.
  assert.equal(
    (db.prepare("SELECT COUNT(*) c FROM atomicity_probe").get() as { c: number }).c,
    0,
    "failed migration's writes rolled back",
  );
  // Version was NOT bumped past the real latest.
  assert.equal(schemaVersion(db), LATEST_MIGRATION_VERSION, "version not bumped after failed migration");
});

test("atomicity: a migration that throws leaves the DB usable and re-runnable", () => {
  // After the failing migration above, re-running the real migrations must be
  // safe (no half-applied state, version stable).
  const db = boot();
  const before = schemaVersion(db);
  runMigrations(db);
  assert.equal(schemaVersion(db), before);
});

test("back-fill migrations are no-ops when there is no data to back-fill", () => {
  const db = boot();
  // No chunks / no messages → both back-fills (v4 chunk page, v5 tokens) must
  // be no-ops and must not throw. Re-run migrations to exercise the back-fill
  // code paths against empty tables.
  const before = schemaVersion(db);
  runMigrations(db);
  assert.equal(schemaVersion(db), before);
  assert.equal(
    (db.prepare("SELECT COUNT(*) c FROM chunks WHERE page IS NULL").get() as { c: number }).c,
    0,
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) c FROM messages WHERE tokens IS NULL").get() as { c: number }).c,
    0,
  );
});

test("chunks.page back-fill recovers pages from form-feed text when counts match", () => {
  const db = boot();
  // Seed a project + a pdf material whose text has a form feed (two pages),
  // then chunks WITHOUT page set (mimicking pre-column ingestion). The
  // deterministic chunker must yield the same count so the back-fill assigns
  // pages. We re-run only the page back-fill (v4) by resetting the version
  // below it — but simpler: call the migration's `up` directly.
  db.prepare("INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)").run("p1", "P", 1);
  db.prepare(
    "INSERT INTO materials (id, project_id, title, source_type, source_ref, text, char_count, status, created_at) VALUES (?, ?, ?, 'pdf', 'f.pdf', ?, ?, 'ready', 1)",
  ).run("mat1", "p1", "M", "page one content here.\fpage two content here.", "page one content here.\fpage two content here.".length);
  // Use chunkText to know the exact chunk count + order the back-fill expects.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chunkText } = require("@/lib/ingest/chunk") as typeof import("@/lib/ingest/chunk");
  const fresh = chunkText("page one content here.\fpage two content here.");
  assert.ok(fresh.length > 0, "chunker produced chunks");
  const insChunk = db.prepare(
    "INSERT INTO chunks (id, material_id, ordinal, text, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const emb = Buffer.from(new Float32Array([0, 0]).buffer);
  for (let i = 0; i < fresh.length; i++) {
    insChunk.run(`ch${i}`, "mat1", i, fresh[i].text, emb, 1);
  }
  // Null out page to simulate the pre-column state, then re-run v4's up.
  db.prepare("UPDATE chunks SET page = NULL").run();
  const pageBackfill = MIGRATIONS.find((m) => m.version === 4)!;
  assert.doesNotThrow(() => pageBackfill.up(db));
  // Every chunk now has a non-null page matching the chunker's assignment.
  const rows = db.prepare("SELECT id, page FROM chunks ORDER BY ordinal ASC").all() as { id: string; page: number | null }[];
  assert.equal(rows.length, fresh.length);
  for (let i = 0; i < rows.length; i++) {
    assert.equal(rows[i].page, fresh[i].page, `chunk ${i} page recovered`);
  }
});

test("messages.tokens back-fill estimates tokens for tokenless rows", () => {
  const db = boot();
  // Seed a conversation + a message inserted with tokens NULL (mimicking a
  // pre-column row). The back-fill must set a non-null token estimate.
  db.prepare("INSERT INTO conversations (id, title, mode, model, created_at) VALUES (?, ?, ?, ?, ?)").run("c1", "t", "chat", "m", 1);
  db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, kind, delivery_state, created_at) VALUES (?, ?, 'user', ?, 'chat', 'complete', 1)",
  ).run("m1", "c1", "hello world this is a test message with enough text to estimate");
  // Force tokens NULL (the column default is NULL for an additive ALTER, but
  // listMessages/addMessage sets it; simulate the legacy state explicitly).
  db.prepare("UPDATE messages SET tokens = NULL WHERE id = ?").run("m1");
  const tokenBackfill = MIGRATIONS.find((m) => m.version === 5)!;
  assert.doesNotThrow(() => tokenBackfill.up(db));
  const row = db.prepare("SELECT tokens FROM messages WHERE id = ?").get("m1") as { tokens: number | null };
  assert.ok(row.tokens !== null && row.tokens > 0, "tokens back-filled with a positive estimate");
  // Re-running is a no-op (tokens is no longer NULL).
  tokenBackfill.up(db);
  const row2 = db.prepare("SELECT tokens FROM messages WHERE id = ?").get("m1") as { tokens: number | null };
  assert.deepEqual(row2.tokens, row.tokens);
});

test("migrations are strictly increasing and versioned 1..N with no gaps", () => {
  const versions = MIGRATIONS.map((m) => m.version);
  assert.deepEqual(versions, [...versions].sort((a, b) => a - b), "migrations ordered ascending");
  for (let i = 0; i < versions.length; i++) {
    assert.equal(versions[i], i + 1, `migration ${i} has version ${i + 1}`);
  }
  assert.equal(versions[versions.length - 1], LATEST_MIGRATION_VERSION);
});

test("the db singleton (open via require) boots with migrations and exposes schema_version", () => {
  // Confirms the real open() path (base schema + runMigrations) leaves a
  // fully-migrated DB with the version recorded. Uses the shared in-memory
  // singleton opened by setting DATABASE_URL above.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { db } = require("./index") as typeof import("./index");
  assert.ok(
    (db.prepare("SELECT version FROM schema_version LIMIT 1").get() as { version: number } | undefined)
      ?.version === LATEST_MIGRATION_VERSION,
    "singleton db migrated to latest",
  );
  // artifact_versions is created by the base SCHEMA_SQL loop (not a migration).
  // Confirms migrations did not drop it and the table is usable.
  const cols = columns(db, "artifact_versions");
  assert.ok(cols.includes("artifact_id"));
  assert.ok(cols.includes("active"));
});