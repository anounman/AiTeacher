import { db } from "./index";
import type { Project } from "./schema";

export function listProjects(): Project[] {
  return db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as Project[];
}

export function getProject(id: string): Project | undefined {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | undefined;
}

export function createProject(name: string): Project {
  const row: Project = { id: crypto.randomUUID(), name, created_at: Date.now() };
  db.prepare("INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)").run(
    row.id, row.name, row.created_at,
  );
  return row;
}

export function renameProject(id: string, name: string): void {
  db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(name, id);
}

export function deleteProject(id: string): void {
  // ON DELETE CASCADE drops materials+chunks; conversations.project_id SET NULL.
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}