import type { Material, SourceEntry } from "@/lib/db/schema";

export type EvidencePayload = {
  source: SourceEntry;
  material: { id: string; title: string; sourceType: Material["source_type"] };
  pageImageUrl: string | null;
  pageAvailable: boolean;
};

export function resolveEvidence(source: SourceEntry, material: Material | null): EvidencePayload {
  const page = material?.source_type === "pdf" && Number.isInteger(source.page) && source.page! > 0
    ? source.page
    : null;

  return {
    source,
    material: material
      ? { id: material.id, title: material.title, sourceType: material.source_type }
      : { id: source.materialId, title: source.title, sourceType: "url" },
    pageImageUrl: page ? `/api/materials/${source.materialId}/evidence?page=${page}` : null,
    pageAvailable: Boolean(page),
  };
}
