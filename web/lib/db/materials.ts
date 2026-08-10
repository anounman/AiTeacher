import { db } from "./index";
import type { Material, MaterialSourceType, MaterialStatus } from "./schema";

export function createMaterial(init: {
  projectId: string;
  title: string;
  sourceType: MaterialSourceType;
  sourceRef: string;
}): Material {
  const row: Material = {
    id: crypto.randomUUID(),
    project_id: init.projectId,
    title: init.title,
    source_type: init.sourceType,
    source_ref: init.sourceRef,
    text: "",
    char_count: 0,
    status: "processing",
    error: null,
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO materials (id, project_id, title, source_type, source_ref, text, char_count, status, error, created_at)
     VALUES (?, ?, ?, ?, ?, '', 0, 'processing', NULL, ?)`,
  ).run(row.id, row.project_id, row.title, row.source_type, row.source_ref, row.created_at);
  return row;
}

export function listMaterials(projectId: string): Material[] {
  return db
    .prepare("SELECT * FROM materials WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as Material[];
}

export function getMaterial(id: string): Material | undefined {
  return db.prepare("SELECT * FROM materials WHERE id = ?").get(id) as Material | undefined;
}

export function updateMaterialStatus(
  id: string,
  status: MaterialStatus,
  opts?: { error?: string; charCount?: number; text?: string },
): void {
  if (status === "error") {
    db.prepare("UPDATE materials SET status = 'error', error = ? WHERE id = ?").run(
      opts?.error ?? "Unknown error", id,
    );
  } else if (status === "ready") {
    db.prepare("UPDATE materials SET status = 'ready', char_count = ?, text = ?, error = NULL WHERE id = ?")
      .run(opts?.charCount ?? 0, opts?.text ?? "", id);
  } else {
    db.prepare("UPDATE materials SET status = ? WHERE id = ?").run(status, id);
  }
}

export function deleteMaterial(id: string): void {
  // ON DELETE CASCADE drops chunks.
  db.prepare("DELETE FROM materials WHERE id = ?").run(id);
}

export function addChunk(
  materialId: string,
  ordinal: number,
  text: string,
  embedding: Buffer,
  loc?: { page?: number } | null,
): void {
  db.prepare(
    "INSERT INTO chunks (id, material_id, ordinal, text, embedding, loc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(crypto.randomUUID(), materialId, ordinal, text, embedding, loc ? JSON.stringify(loc) : null, Date.now());
}

// Insert all chunks for a material inside a single transaction so a mid-loop
// failure leaves no partial chunks. Used by ingestFromText.
export function addChunks(
  materialId: string,
  chunks: { text: string; embedding: Buffer; ordinal: number; loc?: { page?: number } | null }[],
): void {
  const insert = db.prepare(
    "INSERT INTO chunks (id, material_id, ordinal, text, embedding, loc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const run = db.transaction((rows: { text: string; embedding: Buffer; ordinal: number; loc?: { page?: number } | null }[]) => {
    const now = Date.now();
    for (const r of rows) {
      insert.run(
        crypto.randomUUID(),
        materialId,
        r.ordinal,
        r.text,
        r.embedding,
        r.loc ? JSON.stringify(r.loc) : null,
        now,
      );
    }
  });
  run(chunks);
}

// All chunks (with embedding + material title) for a project's READY materials.
export function listChunkEmbeddingsForProject(projectId: string): {
  chunkId: string;
  materialId: string;
  materialTitle: string;
  ordinal: number;
  text: string;
  embedding: Buffer;
  loc: string | null;
}[] {
  return db
    .prepare(
      `SELECT c.id AS chunkId, c.material_id AS materialId, c.ordinal, c.text, c.embedding, c.loc, m.title AS materialTitle
       FROM chunks c JOIN materials m ON m.id = c.material_id
       WHERE m.project_id = ? AND m.status = 'ready'
       ORDER BY c.material_id, c.ordinal`,
    )
    // better-sqlite3 row typing is loose; cast per the plan.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .all(projectId) as any;
}

// Full-text half of hybrid retrieval. The caller supplies an FTS-safe query
// made from quoted terms, so punctuation in a natural-language question never
// becomes FTS syntax. Lower bm25 rank is better.
export function listLexicalChunksForProject(
  projectId: string,
  ftsQuery: string,
  limit = 50,
): {
  chunkId: string;
  materialId: string;
  materialTitle: string;
  ordinal: number;
  text: string;
  loc: string | null;
  rank: number;
}[] {
  if (!ftsQuery) return [];
  return db.prepare(
    `SELECT c.id AS chunkId, c.material_id AS materialId, m.title AS materialTitle,
            c.ordinal, c.text, c.loc, bm25(chunks_fts) AS rank
     FROM chunks_fts
     JOIN chunks c ON c.id = chunks_fts.chunk_id
     JOIN materials m ON m.id = c.material_id
     WHERE chunks_fts MATCH ? AND m.project_id = ? AND m.status = 'ready'
     ORDER BY rank ASC
     LIMIT ?`,
  ).all(ftsQuery, projectId, Math.max(1, Math.min(limit, 200))) as {
    chunkId: string;
    materialId: string;
    materialTitle: string;
    ordinal: number;
    text: string;
    loc: string | null;
    rank: number;
  }[];
}

// The chunks of a single material (id + ordinal + text, NO embedding).
// SP1 reads these to extract concepts per-chunk; the embeddings already
// exist from ingest time and aren't needed here.
export function listChunksForMaterial(materialId: string): { id: string; ordinal: number; text: string }[] {
  return db
    .prepare("SELECT id, ordinal, text FROM chunks WHERE material_id = ? ORDER BY ordinal ASC")
    .all(materialId) as { id: string; ordinal: number; text: string }[];
}
