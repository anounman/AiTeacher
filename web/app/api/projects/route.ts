import { NextResponse } from "next/server";
import { createProject, listProjects, listMaterials } from "@/lib/db";

// GET /api/projects — list all projects with their material counts.
export async function GET() {
  const projects = listProjects();
  const withCounts = projects.map((p) => ({
    ...p,
    materialCount: listMaterials(p.id).length,
  }));
  return NextResponse.json(withCounts);
}

// POST /api/projects — create a new project. Body: { name }
export async function POST(req: Request) {
  const { name } = await req.json().catch(() => ({}));
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  return NextResponse.json(createProject(name.trim()), { status: 201 });
}