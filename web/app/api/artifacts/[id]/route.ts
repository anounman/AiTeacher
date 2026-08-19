import { getMessage, getActiveArtifactVersion, listArtifactVersions, activateArtifactVersion } from "@/lib/db";
import { createArtifactGetHandler, createArtifactPatchHandler } from "@/lib/chat/artifact-route";
import { withRouteHandler } from "@/lib/server/withRouteHandler";

// The DI handlers own body validation and the structured 404/400 responses
// (parseArtifactEntryId, message lookup, version activation). We wrap only for
// the outer error boundary: any thrown error from a dep or extractor becomes a
// sanitized 500 instead of an opaque unhandled exception. No body re-validation
// here — that would duplicate the DI handler's own guards.
const handleGet = createArtifactGetHandler({ getMessage, getActiveArtifactVersion, listArtifactVersions });
const handlePatch = createArtifactPatchHandler({ getMessage, activateArtifactVersion });

export const GET = withRouteHandler<{ id: string }>(({ request, params }) =>
  handleGet(request, { params: Promise.resolve(params) }),
);

export const PATCH = withRouteHandler<{ id: string }>(({ request, params }) =>
  handlePatch(request, { params: Promise.resolve(params) }),
);