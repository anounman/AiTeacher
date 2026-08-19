// DB access for native-artifact version history (study-workflow-upgrades
// Task 5). Pure queries + transactional activation; no HTTP, no model calls.
// Versions are stored SEPARATELY from the immutable assistant message — only
// the active version for an artifact_id overrides the renderer for the
// matching fence (see components/Markdown.tsx → NativeArtifact).
//
// `artifact_id` is the stable entry id from lib/artifacts/entries.ts
// (`${messageId}:artifact:${ordinal}`). `payload` is always a validated
// canonical NativeArtifact — createArtifactVersion rejects anything that does
// not classify as native, so a legacy-HTML or malformed payload can never
// become a version. History is bounded to the newest 20 per artifact.

import { db } from "@/lib/db/index";
import { classifyArtifact } from "@/lib/artifacts/schema";
import type { ArtifactVersion, CreateArtifactVersionInput } from "@/lib/db/schema";
import type { NativeArtifact } from "@/lib/artifacts/schema";

export type { ArtifactVersion, CreateArtifactVersionInput };

const MAX_VERSIONS_PER_ARTIFACT = 20;

// Monotonic timestamp: Date.now() can return the same millisecond across
// several synchronous createArtifactVersion calls, which would make
// newest-first ordering ambiguous (the tests create 22 versions in a tight
// loop). Guarantee strictly increasing created_at by bumping past the last
// value when collisions occur. Lives across calls in the same process so a
// rapid burst stays ordered.
let lastCreatedAt = 0;
function monotonicNow(): number {
  const now = Date.now();
  const value = now <= lastCreatedAt ? lastCreatedAt + 1 : now;
  lastCreatedAt = value;
  return value;
}

type ArtifactVersionRow = Omit<ArtifactVersion, "payload" | "active"> & {
  payload: string;
  active: number;
};

function toVersion(row: ArtifactVersionRow): ArtifactVersion {
  return {
    id: row.id,
    artifact_id: row.artifact_id,
    parent_version_id: row.parent_version_id,
    source_message_id: row.source_message_id,
    payload: JSON.parse(row.payload) as NativeArtifact,
    instruction: row.instruction,
    active: row.active === 1,
    created_at: row.created_at,
  };
}

// Validate the payload is a canonical native artifact. Rejects legacy-HTML and
// malformed JSON payloads with an "Invalid native artifact" message so a bad
// transform output can never be persisted as a version.
function assertValidPayload(payload: unknown): asserts payload is NativeArtifact {
  // Re-serialize→classify so the stored JSON round-trips through the same
  // validator the renderer uses (classifyArtifact parses JSON + validates the
  // envelope). A NativeArtifact object is canonical JSON, so this is exact.
  const classification = classifyArtifact(JSON.stringify(payload));
  if (classification.type !== "native") {
    throw new Error("Invalid native artifact");
  }
}

export function createArtifactVersion(input: CreateArtifactVersionInput): ArtifactVersion {
  assertValidPayload(input.payload);

  const id = crypto.randomUUID();
  const createdAt = monotonicNow();
  const payloadJson = JSON.stringify(input.payload);

  // One transaction: insert the new version, deactivate every other version
  // for this artifact, activate the new one, then trim to the newest 20.
  db.transaction(() => {
    db.prepare(
      `INSERT INTO artifact_versions
         (id, artifact_id, parent_version_id, source_message_id, payload, instruction, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(id, input.artifactId, input.parentVersionId, input.sourceMessageId, payloadJson, input.instruction, createdAt);
    db.prepare("UPDATE artifact_versions SET active = 0 WHERE artifact_id = ? AND id != ?").run(input.artifactId, id);
    // Trim: keep the newest MAX_VERSIONS_PER_ARTIFACT, evict the oldest extras.
    const excess = db
      .prepare(
        `SELECT id FROM artifact_versions
         WHERE artifact_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT -1 OFFSET ?`,
      )
      .all(input.artifactId, MAX_VERSIONS_PER_ARTIFACT) as { id: string }[];
    if (excess.length > 0) {
      const drop = db.prepare("DELETE FROM artifact_versions WHERE id = ?");
      for (const row of excess) drop.run(row.id);
    }
  })();

  return getActiveArtifactVersion(input.artifactId)!;
}

export function getActiveArtifactVersion(artifactId: string): ArtifactVersion | null {
  const row = db
    .prepare("SELECT * FROM artifact_versions WHERE artifact_id = ? AND active = 1 LIMIT 1")
    .get(artifactId) as ArtifactVersionRow | undefined;
  return row ? toVersion(row) : null;
}

export function activateArtifactVersion(artifactId: string, versionId: string): ArtifactVersion | null {
  const target = db
    .prepare("SELECT id FROM artifact_versions WHERE artifact_id = ? AND id = ?")
    .get(artifactId, versionId) as { id: string } | undefined;
  if (!target) return null;

  db.transaction(() => {
    db.prepare("UPDATE artifact_versions SET active = 0 WHERE artifact_id = ?").run(artifactId);
    db.prepare("UPDATE artifact_versions SET active = 1 WHERE artifact_id = ? AND id = ?").run(artifactId, versionId);
  })();

  return getActiveArtifactVersion(artifactId);
}

export function listArtifactVersions(artifactId: string): ArtifactVersion[] {
  const rows = db
    .prepare(
      "SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY created_at DESC, rowid DESC",
    )
    .all(artifactId) as ArtifactVersionRow[];
  return rows.map(toVersion);
}