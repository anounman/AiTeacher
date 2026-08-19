import { getMaterial } from "@/lib/db";
import { ensurePageImages, loadPageImage } from "@/lib/ingest/pdf-pages";
import { createEvidenceGetHandler } from "@/lib/chat/evidence-route";
import { withRouteHandler } from "@/lib/server/withRouteHandler";

// GET /api/materials/[id]/evidence — thin wrapper over the DI-style handler
// factory in lib/chat/evidence-route. That factory owns its own validation
// (uuid + page guards) and intentional 404s, and already awaits `params`.
// We wrap the exported GET in withRouteHandler for an additional error
// boundary: thrown errors (e.g. ensurePageImages failing) are caught and
// sanitized to a 500 rather than bubbling as an opaque 500. The DI handler's
// happy path / 404 behavior is preserved.
const handler = createEvidenceGetHandler({ getMaterial, ensurePageImages, loadPageImage });

export const GET = withRouteHandler<{ id: string }>(async ({ request, params }) =>
  handler(request, { params: Promise.resolve(params) }),
);