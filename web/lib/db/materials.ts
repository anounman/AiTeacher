import { db } from "./index";
import type { Material, MaterialSourceType, MaterialStatus } from "./schema";
// Lazily imported inside deleteMaterial so the DB module graph does not eagerly
// load mupdf (which uses top-level await, incompatible with the project's CJS
// test transpile). deleteMaterial is the only caller and runs at request time,
// not module load — so the dynamic import has no latency impact on the hot path.
type PdfPagesApi = typeof import("@/lib/ingest/pdf-pages");
let pdfPagesPromise: Promise<PdfPagesApi> | null = null;
function loadPdfPages(): Promise<PdfPagesApi> {
  if (!pdfPagesPromise) pdfPagesPromise = import("@/lib/ingest/pdf-pages");
  return pdfPagesPromise;
}

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

// Find a PDF material in a project by its source_ref (the upload filename
// without .pdf). Used by heal-on-reupload: when the user re-uploads a file
// whose name matches an existing deck that predates page-image rendering, we
// heal that deck (attach the PDF + render pages) instead of creating a
// duplicate — so the concept graph and chunks stay intact.
export function findPdfMaterialByRef(projectId: string, sourceRef: string): Material | undefined {
  return db
    .prepare("SELECT * FROM materials WHERE project_id = ? AND source_type = 'pdf' AND source_ref = ? LIMIT 1")
    .get(projectId, sourceRef) as Material | undefined;
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

export async function deleteMaterial(id: string): Promise<void> {
  // ON DELETE CASCADE drops chunks; also remove any rendered page images and
  // the retained source PDF on disk so we don't orphan files when their
  // material row goes away.
  const { deletePageImages, deleteSourcePdf } = await loadPdfPages();
  deletePageImages(id);
  deleteSourcePdf(id);
  db.prepare("DELETE FROM materials WHERE id = ?").run(id);
}

export function addChunk(
  materialId: string,
  ordinal: number,
  text: string,
  embedding: Buffer,
  page: number | null = null,
): void {
  db.prepare(
    "INSERT INTO chunks (id, material_id, ordinal, text, embedding, page, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(crypto.randomUUID(), materialId, ordinal, text, embedding, page, Date.now());
}

// Insert all chunks for a material inside a single transaction so a mid-loop
// failure leaves no partial chunks. Used by ingestFromText.
export function addChunks(
  materialId: string,
  chunks: { text: string; embedding: Buffer; ordinal: number; page: number | null }[],
): void {
  const insert = db.prepare(
    "INSERT INTO chunks (id, material_id, ordinal, text, embedding, page, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const run = db.transaction(
    (rows: { text: string; embedding: Buffer; ordinal: number; page: number | null }[]) => {
      const now = Date.now();
      for (const r of rows) {
        insert.run(crypto.randomUUID(), materialId, r.ordinal, r.text, r.embedding, r.page, now);
      }
    },
  );
  run(chunks);
}

// All chunks (with embedding + material title) for a project's READY materials.
export function listChunkEmbeddingsForProject(projectId: string): {
  chunkId: string;
  materialId: string;
  materialTitle: string;
  ordinal: number;
  page: number | null;
  text: string;
  embedding: Buffer;
}[] {
  return db
    .prepare(
      `SELECT c.id AS chunkId, c.material_id AS materialId, c.ordinal, c.page, c.text, c.embedding, m.title AS materialTitle
       FROM chunks c JOIN materials m ON m.id = c.material_id
       WHERE m.project_id = ? AND m.status = 'ready'
       ORDER BY c.material_id, c.ordinal`,
    )
    // better-sqlite3 row typing is loose; cast per the plan.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .all(projectId) as any;
}

// The chunks of a single material (id + ordinal + text, NO embedding).
// SP1 reads these to extract concepts per-chunk; the embeddings already
// exist from ingest time and aren't needed here.
export function listChunksForMaterial(materialId: string): { id: string; ordinal: number; text: string }[] {
  return db
    .prepare("SELECT id, ordinal, text FROM chunks WHERE material_id = ? ORDER BY ordinal ASC")
    .all(materialId) as { id: string; ordinal: number; text: string }[];
}

// Set a single chunk's page (used by the chunk-page back-fill migration, which
// re-derives page numbers for chunks ingested before the page column existed).
export function setChunkPage(chunkId: string, page: number): void {
  db.prepare("UPDATE chunks SET page = ? WHERE id = ?").run(page, chunkId);
}export function listLexicalChunksForProject(
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

