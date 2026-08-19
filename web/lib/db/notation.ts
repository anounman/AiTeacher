import { db } from "./index";
import type { DiagramType } from "@/lib/chat/diagram-intent";

// Diagram notation cache (vision pipeline). One reusable text note per
// (project, diagram type): the first time a project asks for, say, an ER
// diagram, a short vision call reads the slide page images and writes a note
// describing how THIS course draws ER diagrams. Every later ER-diagram request
// in that project reuses the note with the cheap text model — no vision call,
// no image payloads. See lib/chat/notation.ts for the orchestration.

export interface NotationNote {
  note: string;
  materialIds: string[];
  createdAt: number;
}

// Look up the cached note for (project, type). Returns null if none. The caller
// is responsible for validating materialIds still exist (stale check) before
// trusting the note — see materialIdsAllExist below.
export function getNotationNote(projectId: string, diagramType: DiagramType): NotationNote | null {
  const row = db
    .prepare(
      "SELECT notation_note, material_ids, created_at FROM diagram_notation WHERE project_id = ? AND diagram_type = ?",
    )
    .get(projectId, diagramType) as
    | { notation_note: string; material_ids: string; created_at: number }
    | undefined;
  if (!row) return null;
  let materialIds: string[] = [];
  try {
    const parsed = JSON.parse(row.material_ids);
    if (Array.isArray(parsed)) materialIds = parsed.filter((x) => typeof x === "string");
  } catch {
    materialIds = [];
  }
  return { note: row.notation_note, materialIds, createdAt: row.created_at };
}

// Insert or overwrite the note for (project, type). UNIQUE(project_id,
// diagram_type) + ON CONFLICT DO UPDATE so a re-extraction overwrites the prior
// note in place rather than erroring.
export function saveNotationNote(
  projectId: string,
  diagramType: DiagramType,
  note: string,
  materialIds: string[],
): void {
  db.prepare(
    `INSERT INTO diagram_notation (id, project_id, diagram_type, notation_note, material_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, diagram_type) DO UPDATE SET
       notation_note = excluded.notation_note,
       material_ids = excluded.material_ids,
       created_at = excluded.created_at`,
  ).run(crypto.randomUUID(), projectId, diagramType, note, JSON.stringify(materialIds), Date.now());
}

// Are all of these material ids still present in the project? Used to decide
// whether a cached note is still valid: a delete + re-upload of a slide deck
// creates new material ids, so the note's material_ids would no longer match
// and the note is treated as stale (re-extracted on the next diagram turn).
// An empty materialIds list (legacy/edge) is treated as NOT all-exist so the
// note is re-extracted rather than trusted blindly.
export function materialIdsAllExist(projectId: string, materialIds: string[]): boolean {
  if (materialIds.length === 0) return false;
  const placeholders = materialIds.map(() => "?").join(",");
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM materials WHERE project_id = ? AND id IN (${placeholders})`,
    )
    .get(projectId, ...materialIds) as { n: number };
  return row.n === materialIds.length;
}

// Drop every notation note for a project (called when a project is deleted so
// we don't orphan notes). ON DELETE CASCADE on project_id handles this already,
// but the helper is here for completeness / explicit cleanup paths.
export function deleteNotationForProject(projectId: string): void {
  db.prepare("DELETE FROM diagram_notation WHERE project_id = ?").run(projectId);
}