import { NextResponse } from "next/server";
import { classifyArtifact } from "@/lib/artifacts/schema";
import { extractNativeArtifactEntries, artifactEntryId, type NativeArtifactEntry } from "@/lib/artifacts/entries";
import type { NativeArtifact } from "@/lib/artifacts/schema";
import type { Conversation, Message } from "@/lib/db/schema";

// Resolves an artifact entry id (`${messageId}:artifact:${ordinal}`) to the
// persisted source message + its native entry. Returns null when the id is
// malformed or the fence is not a native entry (e.g. legacy HTML, or an
// ordinal that no longer exists after an edit). The route rejects these.
const ARTIFACT_ID_RE = /^(.+):artifact:(\d+)$/;

export function parseArtifactEntryId(id: string): { messageId: string; ordinal: number } | null {
  const match = ARTIFACT_ID_RE.exec(id);
  if (!match) return null;
  const ordinal = Number(match[2]);
  if (!Number.isInteger(ordinal) || ordinal < 0) return null;
  return { messageId: match[1], ordinal };
}

export function findNativeArtifactEntry(
  entries: NativeArtifactEntry[],
  ordinal: number,
): NativeArtifactEntry | null {
  return entries.find((entry) => entry.ordinal === ordinal) ?? null;
}

// Extracts the single ```artifact JSON fence payload from a model response.
// Requires EXACTLY one fenced artifact block; rejects prose-only or
// multi-fence outputs so a hallucinated extra block can never be persisted.
const ARTIFACT_FENCE = /```artifact[^\S\r\n]*\r?\n([\s\S]*?)(?:\r?\n```|(?![\s\S]))/;

export function extractTransformedArtifactPayload(text: string): string | null {
  const matches = [...text.matchAll(new RegExp(ARTIFACT_FENCE.source, "gm"))];
  if (matches.length !== 1) return null;
  return matches[0][1];
}

type TransformDeps = {
  getMessage: (id: string) => Message | null;
  getConversation: (id: string) => Conversation | undefined;
  getActiveArtifactVersion: (artifactId: string) => { id?: string; payload: NativeArtifact } | null;
  createArtifactVersion: (input: {
    artifactId: string;
    parentVersionId: string | null;
    sourceMessageId: string;
    payload: NativeArtifact;
    instruction: string | null;
  }) => { id: string };
  // Build the project-retrieval context block for the instruction (may be "").
  buildContextBlock: (conversation: Conversation, instruction: string) => Promise<string>;
  // Produce the model's raw text response for the transform prompt. Throws on
  // failure/abort; the handler maps those to 502/499. Injected so the route
  // wires the real `generateText` call and tests stub it.
  generate: (prompt: string, signal: AbortSignal) => Promise<string>;
};

type TransformBody = { artifactId?: string; instruction?: string };

export function createArtifactTransformHandler(deps: TransformDeps) {
  return async function POST(req: Request) {
    let body: TransformBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const { artifactId, instruction } = body;
    if (!artifactId || typeof instruction !== "string" || !instruction.trim()) {
      return NextResponse.json({ error: "Missing artifactId or instruction" }, { status: 400 });
    }

    const parsed = parseArtifactEntryId(artifactId);
    if (!parsed) return NextResponse.json({ error: "Unknown artifact" }, { status: 404 });

    const message = deps.getMessage(parsed.messageId);
    if (!message || message.role !== "assistant") {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }
    const entries = extractNativeArtifactEntries(message.id, message.content);
    const entry = findNativeArtifactEntry(entries, parsed.ordinal);
    // Reject ids that do not resolve to a native entry (legacy HTML fence, or
    // an ordinal that no longer exists). Legacy HTML is never editable.
    if (!entry) return NextResponse.json({ error: "Artifact is not editable" }, { status: 400 });

    const conversation = deps.getConversation(message.conversation_id);
    if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

    // The canonical artifact to transform: the active version if one exists,
    // otherwise the immutable parsed payload from the message fence.
    const active = deps.getActiveArtifactVersion(artifactId);
    const currentArtifact = active?.payload ?? entry.artifact;
    const contextBlock = await deps.buildContextBlock(conversation, instruction);

    const prompt =
      `Current artifact (canonical JSON):\n\`\`\`artifact\n${JSON.stringify(currentArtifact)}\n\`\`\`\n\n` +
      `User instruction: ${instruction.trim()}` +
      (contextBlock ? `\n\nRelevant project context:\n${contextBlock}` : "");

    let text: string;
    try {
      text = await deps.generate(prompt, req.signal);
    } catch (error) {
      // A failed request never creates a version — the current version stays
      // active and the UI shows a retry affordance.
      if ((error as { name?: string }).name === "AbortError") return NextResponse.json({ error: "Cancelled" }, { status: 499 });
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Transform failed" },
        { status: 502 },
      );
    }

    const payload = extractTransformedArtifactPayload(text);
    if (!payload) {
      return NextResponse.json({ error: "Model did not return a single artifact block" }, { status: 502 });
    }
    const classification = classifyArtifact(payload);
    if (classification.type !== "native") {
      // Invalid transform output is rejected; the current version remains active.
      return NextResponse.json({ error: "Transform output was not a valid native artifact" }, { status: 422 });
    }

    const created = deps.createArtifactVersion({
      artifactId,
      parentVersionId: active?.id ?? null,
      sourceMessageId: message.id,
      payload: classification.artifact,
      instruction: instruction.trim(),
    });

    return NextResponse.json({ versionId: created.id, artifact: classification.artifact }, { status: 201 });
  };
}

// Re-exported so the GET route + UI share one id shape.
export { artifactEntryId };