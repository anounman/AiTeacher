import { NextResponse } from "next/server";
import { deleteMaterial } from "@/lib/db";

// DELETE /api/materials/[id] — cascades to chunks.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await deleteMaterial(id);
  return NextResponse.json({ ok: true });
}