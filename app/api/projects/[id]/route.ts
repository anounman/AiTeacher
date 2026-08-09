import { NextResponse } from "next/server";
import { deleteProject, getProject, listMaterials, renameProject } from "@/lib/db";

// GET /api/projects/[id] — project + its materials.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ project, materials: listMaterials(id) });
}

// PATCH /api/projects/[id] — rename a project. Body: { name }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { name } = await req.json().catch(() => ({}));
  if (typeof name === "string" && name.trim()) renameProject(id, name.trim());
  return NextResponse.json(getProject(id));
}

// DELETE /api/projects/[id] — cascades to materials+chunks; nulls conversations.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  deleteProject(id);
  return NextResponse.json({ ok: true });
}