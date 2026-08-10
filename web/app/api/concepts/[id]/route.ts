import { NextResponse } from "next/server";
import { getConceptDetail } from "@/lib/db";

// GET /api/concepts/[id] — one concept + provenance + neighbors, for the /graph
// detail panel. 404 when the concept id doesn't exist.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const detail = getConceptDetail(id);
  if (!detail) return NextResponse.json({ error: "Concept not found" }, { status: 404 });
  return NextResponse.json(detail);
}