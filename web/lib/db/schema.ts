// SQLite schema for the StudyGPT v1 MVP.
// Two tables only — conversations and messages. Phases 2 (materials/chunks)
// and 3 (concepts/concept_edges) add their own tables later.
//
// Run via migrate() in index.ts on first connect; uses CREATE TABLE IF NOT EXISTS
// so it's idempotent and safe to extend.

import type { Band } from "@/lib/mastery/model";
import type { NativeArtifact } from "@/lib/artifacts/schema";

export const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'chat',
    model TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'chat',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_conversation
     ON messages(conversation_id, created_at)`,
  // Key-value store for runtime settings (provider, model, baseUrl).
  // Lets the Settings page change config live without touching .env.
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    study_enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    source_type TEXT NOT NULL,      -- 'pdf' | 'url'
    source_ref TEXT NOT NULL,       -- url, or pdf filename
    text TEXT NOT NULL DEFAULT '',
    char_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'processing', -- 'processing' | 'ready' | 'error'
    error TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    text TEXT NOT NULL,
    embedding BLOB NOT NULL,
    loc TEXT,                       -- JSON provenance, e.g. {"page": 4}
    created_at INTEGER NOT NULL,
    FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
  )`,
  // SQLite FTS5 is the lexical half of hybrid retrieval. chunk_id stays
  // unindexed so results can be joined back to authoritative rows/materials.
  `CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    chunk_id UNINDEXED,
    material_id UNINDEXED,
    text,
    tokenize = 'unicode61 remove_diacritics 2'
  )`,
  `CREATE TRIGGER IF NOT EXISTS chunks_fts_insert AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(chunk_id, material_id, text)
    VALUES (new.id, new.material_id, new.text);
  END`,
  `CREATE TRIGGER IF NOT EXISTS chunks_fts_delete AFTER DELETE ON chunks BEGIN
    DELETE FROM chunks_fts WHERE chunk_id = old.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS chunks_fts_update AFTER UPDATE OF text, material_id ON chunks BEGIN
    DELETE FROM chunks_fts WHERE chunk_id = old.id;
    INSERT INTO chunks_fts(chunk_id, material_id, text)
    VALUES (new.id, new.material_id, new.text);
  END`,
  `CREATE TABLE IF NOT EXISTS message_sources (
    message_id TEXT PRIMARY KEY,
    sources TEXT NOT NULL,          -- JSON array
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_material ON chunks(material_id)`,
  // Saved flashcard decks (from an inline ```flashcard block in chat, or
  // created later). conversation_id is nullable: a deck is linked to the
  // conversation it came from so the chat can show "saved ✓ →", but a deck
  // outlives the conversation (SET NULL on conversation delete).
  `CREATE TABLE IF NOT EXISTS decks (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    conversation_id TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
  )`,
  // The cards in a deck. ordinal preserves the deck's original order (used by
  // the review page's prev/next and by the shuffle's reset). ON DELETE CASCADE
  // drops a deck's cards with it.
  `CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY NOT NULL,
    deck_id TEXT NOT NULL,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
  )`,
  // --- Phase 3 (SP1): concept graph ---
  // Concepts are project-scoped and deduped across chunks/materials by a
  // deterministic slug of the label: id = `${projectId}#${slug}`. embedding is
  // the concept's own label+description embedding, used to compute
  // semantically_similar_to edges. source_count is denormalized from
  // concept_sources (recomputed after each extraction).
  `CREATE TABLE IF NOT EXISTS concepts (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    label TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    embedding BLOB,
    source_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, slug)
  )`,
  // Edges between concepts. The 6 LLM-emitted relations plus the computed
  // `semantically_similar_to` (added in a post-pass from concept-embedding
  // cosine). Deduped by (project_id, source, target, relation) keeping the
  // higher confidence_score. ON DELETE CASCADE: drop a concept and its edges go.
  `CREATE TABLE IF NOT EXISTS concept_edges (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    source_concept TEXT NOT NULL,
    target_concept TEXT NOT NULL,
    relation TEXT NOT NULL,
    confidence TEXT NOT NULL,
    confidence_score REAL,
    evidence TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (source_concept) REFERENCES concepts(id) ON DELETE CASCADE,
    FOREIGN KEY (target_concept) REFERENCES concepts(id) ON DELETE CASCADE,
    UNIQUE(project_id, source_concept, target_concept, relation)
  )`,
  // Provenance: which material/chunk a concept was extracted from. One row
  // per (concept, material, chunk ordinal) so a concept found in 3 chunks of
  // 2 materials has 3-6 rows. snippet is the LLM's evidence string for that
  // occurrence. CASCADE on both sides: deleting a concept or a material cleans
  // up its rows (so re-extraction of a material is a clean delete+reinsert).
  `CREATE TABLE IF NOT EXISTS concept_sources (
    id TEXT PRIMARY KEY,
    concept_id TEXT NOT NULL,
    material_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    snippet TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE,
    FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE,
    UNIQUE(concept_id, material_id, ordinal)
  )`,
  // Per-material extraction bookkeeping. content_hash (sha256 of material
  // text) makes re-extraction idempotent: skip materials whose text is
  // unchanged since last extraction. status tracks pending|extracting|ready|
  // error; error holds a per-material failure message (non-fatal — extraction
  // continues for the other materials).
  `CREATE TABLE IF NOT EXISTS material_extractions (
    material_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    content_hash TEXT,
    concept_count INTEGER NOT NULL DEFAULT 0,
    edge_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    extracted_at INTEGER,
    FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_concepts_project ON concepts(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_concept_edges_source ON concept_edges(project_id, source_concept)`,
  `CREATE INDEX IF NOT EXISTS idx_concept_edges_target ON concept_edges(project_id, target_concept)`,
  `CREATE INDEX IF NOT EXISTS idx_concept_sources_concept ON concept_sources(concept_id)`,
  `CREATE INDEX IF NOT EXISTS idx_concept_sources_material ON concept_sources(material_id)`,
  `CREATE INDEX IF NOT EXISTS idx_material_extractions_project ON material_extractions(project_id)`,
  // --- Phase 3: SRS (SP3) ---
  `CREATE TABLE IF NOT EXISTS card_scheduling (
    card_id     TEXT PRIMARY KEY,
    due         INTEGER NOT NULL,
    stability   REAL    NOT NULL DEFAULT 0,
    difficulty  REAL    NOT NULL DEFAULT 0,
    reps        INTEGER NOT NULL DEFAULT 0,
    lapses      INTEGER NOT NULL DEFAULT 0,
    state       INTEGER NOT NULL DEFAULT 0,
    last_review INTEGER,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_card_sched_due ON card_scheduling(due)`,
  `CREATE TABLE IF NOT EXISTS review_log (
    id          TEXT PRIMARY KEY,
    card_id     TEXT NOT NULL,
    deck_id     TEXT NOT NULL,
    grade       INTEGER NOT NULL,
    state       INTEGER NOT NULL,
    stability   REAL    NOT NULL,
    difficulty  REAL    NOT NULL,
    reviewed_at INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
    FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_review_log_card ON review_log(card_id)`,
  `CREATE INDEX IF NOT EXISTS idx_review_log_deck_time ON review_log(deck_id, reviewed_at)`,
  // --- Phase 3: mastery (SP4) — card ↔ concept bridge ---
  `CREATE TABLE IF NOT EXISTS card_concepts (
    card_id     TEXT NOT NULL,
    concept_id  TEXT NOT NULL,
    score       REAL NOT NULL,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
    FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE,
    UNIQUE(card_id, concept_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_card_concepts_card ON card_concepts(card_id)`,
  `CREATE INDEX IF NOT EXISTS idx_card_concepts_concept ON card_concepts(concept_id)`,
  // --- Diagram notation cache (vision pipeline) ---
  `CREATE TABLE IF NOT EXISTS diagram_notation (
    project_id TEXT NOT NULL,
    diagram_type TEXT NOT NULL,
    notation_note TEXT NOT NULL,
    material_ids TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(project_id, diagram_type),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`,
  // --- Contextual chat overlays ---
  `CREATE TABLE IF NOT EXISTS overlay_threads (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    source_message_id TEXT NOT NULL,
    selected_text TEXT NOT NULL,
    text_offset INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS overlay_messages (
    id TEXT PRIMARY KEY,
    overlay_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    reasoning TEXT,
    sources TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (overlay_id) REFERENCES overlay_threads(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_overlay_messages_thread ON overlay_messages(overlay_id, created_at)`,
  // --- Project memory (persistent notes per project) ---
  `CREATE TABLE IF NOT EXISTS project_memory (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    content TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`,
  // --- Message grounding (which sources/materials a message used) ---
  `CREATE TABLE IF NOT EXISTS message_grounding (
    message_id TEXT PRIMARY KEY,
    material_ids TEXT NOT NULL DEFAULT '[]',
    source_count INTEGER NOT NULL DEFAULT 0,
    used_web INTEGER NOT NULL DEFAULT 0,
    used_notation INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    created_at INTEGER NOT NULL
  )`,
  // --- Artifact versioning (edited/transformed native artifacts) ---
  `CREATE TABLE IF NOT EXISTS artifact_versions (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL,
    parent_version_id TEXT,
    source_message_id TEXT,
    payload TEXT NOT NULL,
    instruction TEXT,
    active INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact ON artifact_versions(artifact_id, created_at)`,
] as const;

export type ConversationMode = "chat" | "feynman" | "teach";

// Per-message output kind. "chat" is the default conversational reply;
// "document" marks a one-shot authored document (the "Document" send action)
// so the chat renders it as a document card with a Print/Save-as-PDF action
// rather than a normal chat bubble.
export type MessageKind = "chat" | "document";

export interface Conversation {
  id: string;
  title: string;
  mode: ConversationMode;
  model: string;
  project_id: string | null;
  persona_preset: TeacherPersonaPreset;
  persona_context: string;
  created_at: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  kind: MessageKind;
  attachments: Attachment[] | null;
  // Rough token estimate (see lib/tokens). Stored so the global token count in
  // Settings is a single SUM, not a full table scan in the client. Null only
  // for rows created before the column existed (backfilled at db open).
  tokens: number | null;
  created_at: number;
}

export type MaterialStatus = "processing" | "ready" | "error";
export type MaterialSourceType = "pdf" | "file" | "url";

export type TeacherPersonaPreset =
  | "beginner"
  | "socratic"
  | "visual"
  | "exam-coach"
  | "concise";

export interface Project {
  id: string;
  name: string;
  study_enabled: boolean;
  created_at: number;
}

export interface ProjectMemoryEntry {
  id: string;
  project_id: string;
  content: string;
  active: boolean;
  created_at: number;
  updated_at: number;
}

// A saved flashcard deck. `conversation_id` is the chat it came from (nullable;
// SET NULL when that conversation is deleted — the deck survives). Matches the
// table-row convention (snake_case fields, like Project/Material).
export interface Deck {
  id: string;
  title: string;
  conversation_id: string | null;
  daily_new_limit: number;
  created_at: number;
}

// One card in a deck. `front`/`back` are markdown source (math via $...$),
// rendered with the shared Markdown pipeline. `ordinal` preserves deck order.
export interface Card {
  id: string;
  deck_id: string;
  front: string;
  back: string;
  ordinal: number;
  created_at: number;
}

export interface CardScheduling {
  card_id: string;
  due: number;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: number | null;
  created_at: number;
  updated_at: number;
}
export interface ReviewLog {
  id: string;
  card_id: string;
  deck_id: string;
  grade: number;
  state: number;
  stability: number;
  difficulty: number;
  reviewed_at: number;
}

export interface Material {
  id: string;
  project_id: string;
  title: string;
  source_type: MaterialSourceType;
  source_ref: string;
  text: string;
  char_count: number;
  status: MaterialStatus;
  error: string | null;
  created_at: number;
}

export interface Chunk {
  id: string;
  material_id: string;
  ordinal: number;
  text: string;
  embedding: Buffer; // Float32Array serialized
  loc: string | null;
  created_at: number;
}

export interface SourceEntry {
  sourceId?: string;
  chunkId?: string;
  materialId: string;
  title: string;
  snippet: string;
  ordinal: number;
  page?: number | null;
  concepts?: { label: string; band: Band }[];
}

// --- Message metadata (activities, grounding) ---

export type MessageDeliveryState = "complete" | "interrupted";

export interface MessageActivity {
  phase: string;
  label: string;
  ordinal: number;
}

export interface MessageGrounding {
  materialIds: string[];
  sourceCount: number;
  usedNotation: boolean;
  usedWeb: boolean;
  model: string | null;
}

// --- Contextual chat overlays ---

export interface OverlayThread {
  id: string;
  conversation_id: string;
  source_message_id: string;
  selected_text: string;
  text_offset: number;
  created_at: number;
  updated_at: number;
}

export interface OverlayMessage {
  id: string;
  overlay_id: string;
  role: "user" | "assistant";
  content: string;
  reasoning: string | null;
  sources: SourceEntry[];
  created_at: number;
}

// --- Artifact versioning ---

export interface ArtifactVersion {
  id: string;
  artifact_id: string;
  parent_version_id: string | null;
  source_message_id: string;
  payload: NativeArtifact;
  instruction: string | null;
  active: boolean;
  created_at: number;
}

export type CreateArtifactVersionInput = {
  artifactId: string;
  parentVersionId?: string | null;
  sourceMessageId?: string | null;
  payload: NativeArtifact;
  instruction?: string | null;
};

// --- Phase 3 (SP1): concept graph types ---

// Confidence trail for an edge (adapted from the graphify skill's audit
// discipline). EXTRACTED = directly stated in the source; INFERRED = reasoned
// from context; AMBIGUOUS = weak/uncertain. semantically_similar_to edges are
// always INFERRED (computed, not extracted).
export type EdgeConfidence = "EXTRACTED" | "INFERRED" | "AMBIGUOUS";

// The 6 LLM-emitted study-flavored relations, plus the computed
// semantically_similar_to (NOT emitted by the LLM — added in a post-pass).
export type ConceptRelation =
  | "prerequisite_of"
  | "part_of"
  | "example_of"
  | "contrasts_with"
  | "applies_to"
  | "generalizes"
  | "semantically_similar_to";

export interface Concept {
  id: string;
  project_id: string;
  label: string;
  slug: string;
  description: string | null;
  embedding: Buffer | null;
  source_count: number;
  created_at: number;
  updated_at: number;
}

export interface ConceptEdge {
  id: string;
  project_id: string;
  source_concept: string;
  target_concept: string;
  relation: ConceptRelation;
  confidence: EdgeConfidence;
  confidence_score: number | null;
  evidence: string | null;
  created_at: number;
}

export interface ConceptSource {
  id: string;
  concept_id: string;
  material_id: string;
  ordinal: number;
  snippet: string | null;
  created_at: number;
}

export interface CardConcept {
  card_id: string;
  concept_id: string;
  score: number;
  created_at: number;
}

export type MaterialExtractionStatus = "pending" | "extracting" | "ready" | "error";

export interface MaterialExtraction {
  material_id: string;
  project_id: string;
  status: MaterialExtractionStatus;
  content_hash: string | null;
  concept_count: number;
  edge_count: number;
  error: string | null;
  extracted_at: number | null;
}

// A single attachment on a user message. Stored as JSON in messages.attachments.
// Images are kept as data URLs and, for the parsing layer, carry their OCR'd
// text so any model — even one without native vision — can ingest the image:
// vision-capable models get the image part directly; text-only models get the
// `text` inlined instead. Text files have their extracted text inlined too.
export type Attachment =
  | { type: "image"; name: string; mime: string; dataUrl: string; text?: string; charCount?: number }
  | { type: "file"; name: string; text: string; charCount: number };
