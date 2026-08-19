import { generateText } from "ai";
import { getMessage, getConversation, getActiveArtifactVersion, createArtifactVersion } from "@/lib/db";
import { retrieve } from "@/lib/retrieval";
import { getModelConfig, getProvider } from "@/lib/llm/provider";
import { createArtifactTransformHandler } from "@/lib/chat/artifact-transform";
import { ARTIFACT_TRANSFORM_PROMPT } from "@/lib/prompts";
import { withRouteHandler } from "@/lib/server/withRouteHandler";
import type { Conversation } from "@/lib/db/schema";

// Build a project-retrieval context block for the transform instruction, so a
// transformed artifact stays grounded in the course materials. Returns "" when
// the conversation has no project or retrieval finds nothing.
async function buildContextBlock(conversation: Conversation, instruction: string): Promise<string> {
  if (!conversation.project_id) return "";
  const result = await retrieve({
    projectId: conversation.project_id,
    lastUser: { role: "user", content: instruction },
    lastUserContent: instruction,
    messages: [{ role: "user", content: instruction }],
  });
  return result?.contextBlock ?? "";
}

// Produce the model's raw text for a transform prompt. Uses the configured
// default chat model (the conversation's own model is the same default in
// practice). Non-streaming — a transform is a short, bounded one-shot.
async function generate(prompt: string, signal: AbortSignal): Promise<string> {
  const cfg = getModelConfig();
  const provider = getProvider(cfg.provider);
  const model = provider.languageModel({ model: cfg.model, baseURL: cfg.baseURL, apiKey: cfg.apiKey });
  const result = await generateText({
    model,
    system: ARTIFACT_TRANSFORM_PROMPT,
    prompt,
    abortSignal: signal,
    maxRetries: 0,
  });
  return result.text;
}

// The DI transform handler reads the body itself and returns structured
// 400/404/422/502/499 responses (and maps its own thrown generate errors to
// 502/499). We wrap only for the outer error boundary — any other thrown error
// (a dep failure, retrieval throw, etc.) becomes a sanitized 500. We do NOT
// re-parse the body here.
const handleTransform = createArtifactTransformHandler({
  getMessage,
  getConversation,
  getActiveArtifactVersion,
  createArtifactVersion,
  buildContextBlock,
  generate,
});

export const POST = withRouteHandler<{ id: string }>(({ request }) => handleTransform(request));