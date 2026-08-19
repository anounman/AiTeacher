// Versioned, recorded DB migrations. Replaces the 151-line boot block that
// used to run in lib/db/index.ts's open() on EVERY boot (PRAGMA table_info
// scans, additive ALTERs, a chunk-page back-fill, a token back-fill).
//
// "Has this migration run?" is now recorded in a `schema_version` table
// (single row holding the highest applied migration number), not inferred
// from data shape. Each migration runs at most once per DB and is recorded;
// the block stops growing on every boot.
//
// CRITICAL behavior contract:
// - The base `CREATE TABLE IF NOT EXISTS` statements in lib/db/schema.ts
//   (SCHEMA_SQL) run FIRST in open() and are idempotent. These migrations run
//   SECOND. Several "additive column" migrations are NO-OPS on a fresh DB
//   because the column already exists in SCHEMA_SQL (e.g. messages.kind,
//   messages.delivery_state, chunks.page, overlay_threads.text_offset). They
//   are kept here so an EXISTING on-disk DB from before the column was added
//   to SCHEMA_SQL still gets it. Every `up` is guarded by PRAGMA table_info /
//   data-shape checks so it is a no-op when the change is already present.
// - On a fresh in-memory DB, runMigrations produces the SAME final schema +
//   back-fills as the old open() block did (additive columns not in SCHEMA_SQL
//   get added; back-fills find no rows to touch).
// - On an existing DB that already ran the old open() block (all columns
//   present, back-fills done), every migration's `up` is a NO-OP (guarded) and
//   only the version gets recorded up to the latest. The user's data is
//   untouched.
//
// Note on the material_extractions crash-recovery reset: the old open() ran
// `UPDATE material_extractions SET status='pending' WHERE status='extracting'`
// on EVERY boot. It is a recurring crash-recovery sweep (any 'extracting' row
// at startup is stale because no build is running), NOT a one-time migration.
// It is kept as a recurring post-migration step in open(), NOT folded into a
// migration here. Folding it in would stop the sweep from running after a
// crash on boot N+1.

import Database from "better-sqlite3";
import { chunkText } from "@/lib/ingest/chunk";
import { estimateTokens } from "@/lib/tokens";

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

// Ordered additive migrations ported from the old open() boot block. Each
// `up` is idempotent (guarded) so it is a no-op when its change is already
// present, and atomic (wrapped in a transaction) so a failure leaves no
// half-applied state. v4 (chunk-page back-fill) is the exception: best-effort,
// it catches internally and never throws.
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "additive columns: conversations.project_id, messages.attachments/tokens/kind/delivery_state, decks.daily_new_limit",
    up: (db) => {
      db.transaction(() => {
        // conversations.project_id — references projects(id), SET NULL on
        // delete. Adding a REFERENCES column with FK ON is allowed (ADD COLUMN
        // does not validate existing rows).
        const convCols = db.prepare("PRAGMA table_info(conversations)").all() as { name: string }[];
        if (!convCols.some((c) => c.name === "project_id")) {
          db.exec("ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL");
        }
        // messages columns. kind/delivery_state are already in SCHEMA_SQL on a
        // fresh DB (no-op guard fires); attachments/tokens are not, so they get
        // added. Existing rows pick up column defaults — no back-fill needed for
        // these four except tokens (see migration v5).
        const msgCols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
        if (!msgCols.some((c) => c.name === "attachments")) {
          db.exec("ALTER TABLE messages ADD COLUMN attachments TEXT");
        }
        if (!msgCols.some((c) => c.name === "tokens")) {
          db.exec("ALTER TABLE messages ADD COLUMN tokens INTEGER");
        }
        if (!msgCols.some((c) => c.name === "kind")) {
          db.exec("ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'");
        }
        if (!msgCols.some((c) => c.name === "delivery_state")) {
          db.exec("ALTER TABLE messages ADD COLUMN delivery_state TEXT NOT NULL DEFAULT 'complete'");
        }
        // decks.daily_new_limit — per-deck daily new-card cap. Already-existing
        // decks get the column default 20 (no back-fill needed).
        const deckCols = db.prepare("PRAGMA table_info(decks)").all() as { name: string }[];
        if (!deckCols.some((c) => c.name === "daily_new_limit")) {
          db.exec("ALTER TABLE decks ADD COLUMN daily_new_limit INTEGER NOT NULL DEFAULT 20");
        }
      })();
    },
  },
  {
    version: 2,
    name: "overlay_threads rebuild with text_offset in unique key",
    up: (db) => {
      // Idempotent: skip if text_offset already exists (fresh DB has it from
      // SCHEMA_SQL; an existing DB that already ran the old rebuild has it too).
      const overlayThreadCols = db.prepare("PRAGMA table_info(overlay_threads)").all() as { name: string }[];
      if (overlayThreadCols.some((c) => c.name === "text_offset")) return;
      // FK must be OFF for the DROP TABLE: overlay_messages references
      // overlay_threads (ON DELETE CASCADE), and with FK on SQLite refuses to
      // drop a parent table that has referencing children. Toggling FK inside a
      // transaction is disallowed by SQLite, so the toggle brackets the
      // transaction. Restored to ON in finally so later migrations / queries
      // keep FK enforcement.
      db.pragma("foreign_keys = OFF");
      try {
        db.transaction(() => {
          db.exec(`CREATE TABLE overlay_threads_next (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            source_message_id TEXT NOT NULL,
            selected_text TEXT NOT NULL,
            text_offset INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
            FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE CASCADE,
            UNIQUE(conversation_id, source_message_id, selected_text, text_offset)
          )`);
          db.exec(`INSERT INTO overlay_threads_next
            (id, conversation_id, source_message_id, selected_text, text_offset, created_at, updated_at)
            SELECT id, conversation_id, source_message_id, selected_text, 0, created_at, updated_at
            FROM overlay_threads`);
          db.exec("DROP TABLE overlay_threads");
          db.exec("ALTER TABLE overlay_threads_next RENAME TO overlay_threads");
          db.exec("CREATE INDEX idx_overlay_threads_conversation ON overlay_threads(conversation_id, source_message_id, updated_at DESC)");
        })();
      } finally {
        db.pragma("foreign_keys = ON");
      }
    },
  },
  {
    version: 3,
    name: "chunks.page additive column",
    up: (db) => {
      db.transaction(() => {
        // Idempotent: chunks.page is already in SCHEMA_SQL on a fresh DB, so
        // this guard is a no-op there; it only adds the column on an existing
        // DB predating the column.
        const chunkCols = db.prepare("PRAGMA table_info(chunks)").all() as { name: string }[];
        if (!chunkCols.some((c) => c.name === "page")) {
          db.exec("ALTER TABLE chunks ADD COLUMN page INTEGER");
        }
      })();
    },
  },
  {
    version: 4,
    name: "chunks.page back-fill from materials.text (best-effort)",
    up: (db) => {
      // Best-effort: never throw. Re-derive page numbers for chunks ingested
      // before the page column existed (page IS NULL), only when recoverable
      // from text (material has form-feed page breaks AND the fresh chunk count
      // matches the existing count). Materials with no form feed (old
      // mergePages:true extraction) cannot be recovered from text alone — left
      // for the heal-on-reupload path. No PDF bytes, no re-ingest, no embedding
      // regen: chunks/concept graph untouched. Idempotent: only touches rows
      // with page IS NULL, so on a DB that already ran this it is a no-op.
      try {
        const nullPageMaterials = db
          .prepare("SELECT DISTINCT material_id AS mid FROM chunks WHERE page IS NULL")
          .all() as { mid: string }[];
        if (nullPageMaterials.length === 0) return;
        const getMaterialRow = db.prepare("SELECT text FROM materials WHERE id = ? AND source_type = 'pdf'");
        const listChunks = db.prepare("SELECT id, ordinal FROM chunks WHERE material_id = ? ORDER BY ordinal ASC");
        const setPage = db.prepare("UPDATE chunks SET page = ? WHERE id = ?");
        for (const { mid } of nullPageMaterials) {
          const mat = getMaterialRow.get(mid) as { text: string } | undefined;
          if (!mat || !mat.text || !mat.text.includes("\f")) continue; // no page boundaries → can't recover from text
          const fresh = chunkText(mat.text);
          const existing = listChunks.all(mid) as { id: string; ordinal: number }[];
          if (fresh.length === 0 || fresh.length !== existing.length) continue; // count mismatch → skip, leave null
          for (let i = 0; i < existing.length; i++) {
            setPage.run(fresh[i].page, existing[i].id);
          }
        }
      } catch {
        // Never block db open on a back-fill failure.
      }
    },
  },
  {
    version: 5,
    name: "messages.tokens back-fill for rows predating the column",
    up: (db) => {
      // Idempotent: only touches rows with tokens IS NULL. On a DB that already
      // ran this (or where every message was inserted with tokens), it's a
      // no-op. estimateTokens / JSON.parse are safe on any stored content; the
      // attachment parse is already individually guarded.
      db.transaction(() => {
        const tokenless = db
          .prepare("SELECT id, content, attachments FROM messages WHERE tokens IS NULL")
          .all() as { id: string; content: string; attachments: string | null }[];
        if (tokenless.length === 0) return;
        const upd = db.prepare("UPDATE messages SET tokens = ? WHERE id = ?");
        for (const r of tokenless) {
          let extra = "";
          if (r.attachments) {
            try {
              const a = JSON.parse(r.attachments);
              if (Array.isArray(a)) {
                for (const x of a) {
                  const t = x?.text;
                  if (typeof t === "string") extra += `\n${t}`;
                }
              }
            } catch {
              // ignore malformed attachments
            }
          }
          upd.run(estimateTokens(r.content + extra), r.id);
        }
      })();
    },
  },
  {
    version: 6,
    name: "projects.study_enabled additive column (study capability flag)",
    up: (db) => {
      // Idempotent: projects.study_enabled is already in SCHEMA_SQL on a fresh
      // DB, so this guard is a no-op there; it only adds the column on an
      // existing on-disk DB predating the column. DEFAULT 1 backfills every
      // existing project to study-enabled so current users keep the study
      // behavior they had (study flavoring was unconditional before this
      // column). New projects created via the API default to 0 (general-first);
      // the migration default only governs the backfill of pre-existing rows.
      db.transaction(() => {
        const projectCols = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
        if (!projectCols.some((c) => c.name === "study_enabled")) {
          db.exec("ALTER TABLE projects ADD COLUMN study_enabled INTEGER NOT NULL DEFAULT 1");
        }
      })();
    },
  },
];

export const LATEST_MIGRATION_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

// Apply every pending migration in order, recording the highest applied
// version in `schema_version`. Each migration's `up` is atomic (it wraps its
// body in a transaction); after a successful `up`, the recorded version is
// bumped. If `up` throws, its transaction has already rolled back and
// runMigrations re-throws WITHOUT bumping the version — so no half-applied
// migration is ever recorded as applied. (Re-running on the next boot
// re-applies the rolled-back migration; since every `up` is idempotent, the
// parts that did commit on a prior partial run are no-ops.)
//
// `migrations` is injectable purely so the atomicity test can pass a failing
// dummy migration; production callers use the default MIGRATIONS.
export function runMigrations(db: Database.Database, migrations: Migration[] = MIGRATIONS): void {
  // Single-row version table. DEFAULT 0 so an INSERT-without-value starts at 0.
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL DEFAULT 0)");
  // Ensure exactly one row exists (a fresh table has none). UPSERT so it is
  // safe whether or not the row already exists.
  db.exec("INSERT INTO schema_version (version) VALUES (0) ON CONFLICT DO NOTHING");
  const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as { version: number } | undefined;
  let current = row?.version ?? 0;

  for (const migration of migrations) {
    if (migration.version <= current) continue;
    migration.up(db); // throws → transaction rolls back, we re-throw, no bump
    db.prepare("UPDATE schema_version SET version = ?").run(migration.version);
    current = migration.version;
  }
}