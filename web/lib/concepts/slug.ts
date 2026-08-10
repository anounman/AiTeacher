import { createHash } from "node:crypto";

// Normalize a concept label into a stable lowercase slug used for the
// deterministic concept id (`${projectId}#${slug}`) so the same concept found
// in different chunks/materials — even with different capitalization or
// accents — collapses to one row. Mirrors the graphify skill's invariant:
// ids are normalized lowercase [a-z0-9-], never chunk-suffixed.
export function normalizeLabel(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // strip combining marks (ü→u, é→e) after NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // non-alnum runs → single dash
    .replace(/^-+|-+$/g, "") // trim leading/trailing dashes
    .slice(0, 120);
}

// sha256 hex of a material's text — the idempotency key. If a material's
// content_hash matches its last extraction, we skip re-extracting it.
export function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}