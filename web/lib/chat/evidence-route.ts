import { NextResponse } from "next/server";
import type { Material } from "@/lib/db/schema";

type EvidenceDependencies = {
  getMaterial: (id: string) => Material | undefined;
  ensurePageImages: (materialId: string) => Promise<boolean>;
  loadPageImage: (materialId: string, page: number) => Uint8Array | null;
};

const MATERIAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export function createEvidenceGetHandler({
  getMaterial,
  ensurePageImages,
  loadPageImage,
}: EvidenceDependencies) {
  return async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
  ) {
    const { id } = await params;
    const page = Number(new URL(request.url).searchParams.get("page"));
    if (!MATERIAL_ID.test(id) || !(Number.isInteger(page) && page > 0)) return notFound();

    const material = getMaterial(id);
    if (!material || material.source_type !== "pdf") return notFound();
    if (!await ensurePageImages(material.id)) return notFound();

    const image = loadPageImage(material.id, page);
    if (!image) return notFound();

    return new NextResponse(new Uint8Array(image), { headers: { "content-type": "image/jpeg" } });
  };
}
