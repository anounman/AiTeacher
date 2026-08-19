import { db } from "./index";
import type { ProjectMemoryEntry } from "./schema";

function row(entry: Omit<ProjectMemoryEntry, "active"> & { active: number }): ProjectMemoryEntry {
  return { ...entry, active: Boolean(entry.active) };
}

export function listProjectMemory(projectId: string): ProjectMemoryEntry[] {
  return (db.prepare("SELECT * FROM project_memory WHERE project_id = ? ORDER BY updated_at DESC").all(projectId) as (Omit<ProjectMemoryEntry, "active"> & { active: number })[]).map(row);
}

export function listActiveProjectMemory(projectId: string): ProjectMemoryEntry[] {
  return (db.prepare("SELECT * FROM project_memory WHERE project_id = ? AND active = 1 ORDER BY updated_at DESC").all(projectId) as (Omit<ProjectMemoryEntry, "active"> & { active: number })[]).map(row);
}

export function addProjectMemory(projectId: string, content: string): ProjectMemoryEntry {
  const now = Date.now();
  const entry: ProjectMemoryEntry = { id: crypto.randomUUID(), project_id: projectId, content, active: true, created_at: now, updated_at: now };
  db.prepare("INSERT INTO project_memory (id, project_id, content, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(entry.id, entry.project_id, entry.content, 1, now, now);
  return entry;
}

export function setProjectMemoryActive(id: string, active: boolean): void {
  db.prepare("UPDATE project_memory SET active = ?, updated_at = ? WHERE id = ?").run(Number(active), Date.now(), id);
}

export function deleteProjectMemory(id: string): void {
  db.prepare("DELETE FROM project_memory WHERE id = ?").run(id);
}
