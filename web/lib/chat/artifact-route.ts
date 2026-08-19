import { NextResponse } from "next/server";
import { parseArtifactEntryId } from "@/lib/chat/artifact-transform";
import { extractNativeArtifactEntries, artifactEntryId, type NativeArtifactEntry } from "@/lib/artifacts/entries";
import type { NativeArtifact } from "@/lib/artifacts/schema";
import type { Message, ArtifactVersion } from "@/lib/db/schema";

// GET /api/artifacts/[id] — returns the canonical native artifact entry plus
// its bounded version history. The "active" artifact is the active version if
// one exists, otherwise the immutable parsed payload from the message fence.
// 404 for an id that does not resolve to a native entry (legacy HTML, missing
// message, bad ordinal) so the UI can fall back to the rendered message.
type GetDeps = {
  getMessage: (id: string) => Message | null;
  getActiveArtifactVersion: (artifactId: string) => ArtifactVersion | null;
  listArtifactVersions: (artifactId: string) => ArtifactVersion[];
};

export type ArtifactGetResponse = {
  artifactId: string;
  messageId: string;
  ordinal: number;
  entry: { kind: NativeArtifact["kind"]; title?: string; summary?: string };
  active: { payload: NativeArtifact; versionId: string | null };
  history: { id: string; instruction: string | null; active: boolean; created_at: number }[];
};

export function createArtifactGetHandler(deps: GetDeps) {
  return async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const { id } = await params;
    const parsed = parseArtifactEntryId(id);
    if (!parsed) return NextResponse.json({ error: "Unknown artifact" }, { status: 404 });

    const message = deps.getMessage(parsed.messageId);
    if (!message || message.role !== "assistant") {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }
    const entries = extractNativeArtifactEntries(message.id, message.content);
    const entry = entries.find((e) => e.ordinal === parsed.ordinal);
    if (!entry) return NextResponse.json({ error: "Artifact is not editable" }, { status: 404 });

    const active = deps.getActiveArtifactVersion(id);
    const history = deps.listArtifactVersions(id);

    const body: ArtifactGetResponse = {
      artifactId: id,
      messageId: message.id,
      ordinal: parsed.ordinal,
      entry: { kind: entry.artifact.kind, title: entry.artifact.title, summary: entry.artifact.summary },
      active: {
        payload: active?.payload ?? entry.artifact,
        versionId: active?.id ?? null,
      },
      history: history.map((v) => ({
        id: v.id,
        instruction: v.instruction,
        active: v.active,
        created_at: v.created_at,
      })),
    };
    return NextResponse.json(body);
  };
}

// PATCH /api/artifacts/[id] — activate an earlier version. Accepts only a
// known version id for that artifact; never mutates the original assistant
// message. 404 for an unknown artifact/version.
type PatchDeps = {
  getMessage: (id: string) => Message | null;
  activateArtifactVersion: (artifactId: string, versionId: string) => ArtifactVersion | null;
};

export function createArtifactPatchHandler(deps: PatchDeps) {
  return async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const { id } = await params;
    const parsed = parseArtifactEntryId(id);
    if (!parsed) return NextResponse.json({ error: "Unknown artifact" }, { status: 404 });

    const message = deps.getMessage(parsed.messageId);
    if (!message || message.role !== "assistant") {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }
    // Confirm the id still resolves to a native entry before activating, so a
    // stale version can't be restored onto an edited-away fence.
    const entries = extractNativeArtifactEntries(message.id, message.content);
    if (!entries.some((e) => e.ordinal === parsed.ordinal)) {
      return NextResponse.json({ error: "Artifact is not editable" }, { status: 404 });
    }

    let body: { versionId?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.versionId) return NextResponse.json({ error: "Missing versionId" }, { status: 400 });

    const activated = deps.activateArtifactVersion(id, body.versionId);
    if (!activated) return NextResponse.json({ error: "Unknown version" }, { status: 404 });
    return NextResponse.json({ versionId: activated.id, artifact: activated.payload });
  };
}

export { artifactEntryId, extractNativeArtifactEntries };
export type { NativeArtifactEntry };