import { db } from "./index";
import type { Project } from "./schema";

export function listProjects(): Project[] {
  const rows = db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as Record<string, unknown>[];
  return rows.map((p) => ({ ...p, study_enabled: !!p.study_enabled })) as Project[];
}

export function getProject(id: string): Project | undefined {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? ({ ...row, study_enabled: !!row.study_enabled } as Project) : undefined;
}

export function createProject(name: string, studyEnabled = true): Project {
  const row: Project = { id: crypto.randomUUID(), name, study_enabled: studyEnabled, created_at: Date.now() };
  db.prepare("INSERT INTO projects (id, name, study_enabled, created_at) VALUES (?, ?, ?, ?)").run(
    row.id, row.name, row.study_enabled ? 1 : 0, row.created_at,
  );
  return row;
}

export function setProjectStudyEnabled(id: string, enabled: boolean): void {
  db.prepare("UPDATE projects SET study_enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}

export function renameProject(id: string, name: string): void {
  db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(name, id);
}

export function deleteProject(id: string): void {
  // ON DELETE CASCADE drops materials+chunks; conversations.project_id SET NULL.
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}