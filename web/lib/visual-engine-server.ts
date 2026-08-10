import { resolveSlotConfig } from "@/lib/llm/slots";
import {
  OllamaClient,
  visualizeConcept as runEngine,
  type CourseId,
  type LLMClient,
  type VisualizeResult,
} from "@/lib/visual-engine/index";

// Bridge between AiTeacher's model slots and the vendored visual engine
// (github.com/JayanshJ/study-visual-engine, copied verbatim into
// lib/visual-engine — see its package.json note before editing it).
//
// The engine takes an injected `LLMClient` so it never learns where models come
// from. Its own `OllamaClient` already speaks the OpenAI-compatible
// /v1/chat/completions shape we use, with streaming and the wall-clock abort
// that turns a slow model into repair input rather than a hung request — so the
// bridge is slot resolution, not a reimplementation.
//
// The `visual` slot is the right one by construction: this is lesson visual
// direction, which is what that slot exists for. Resolution order (call-site →
// env → Settings → config file) comes along for free.

export function visualEngineClient(override?: { model?: string }): LLMClient {
  const config = resolveSlotConfig("visual", override);
  return new OllamaClient({
    // The engine's client appends `/v1/chat/completions`, while our slot
    // config already carries the OpenAI-compatible base (…:11434/v1). Left
    // alone that posts to /v1/v1/… and Ollama answers a bare 404 with no clue
    // why. Normalising here keeps the vendored engine untouched.
    baseUrl: config.baseURL.replace(/\/v1\/?$/, ""),
    apiKey: config.apiKey,
    model: config.model,
  });
}

export function visualSlotModel(): string {
  return resolveSlotConfig("visual").model;
}

/** Server-side entry point: resolve the slot, run decompose + layout. */
export async function visualizeConcept(
  query: string,
  opts: { courseHint?: string; timeoutMs?: number } = {},
): Promise<VisualizeResult> {
  return runEngine(query, visualEngineClient(), {
    courseHint: opts.courseHint as CourseId | undefined,
    // Well inside the route's own patience. The engine turns a timeout into
    // repair input rather than an error, so a slow model degrades to a
    // simpler diagram instead of no diagram.
    timeoutMs: opts.timeoutMs ?? 45_000,
  });
}
