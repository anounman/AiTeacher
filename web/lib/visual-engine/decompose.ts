/**
 * Stage 1 — Decompose: turn a user query into a ConceptDoc-shaped JSON string.
 *
 * Only this stage touches an LLM. The model is asked to TEACH the concept first, then pick a
 * diagramType and emit a semantic graph with NO coordinates. Layout + render are code.
 *
 * The LLM client is an injected interface (`LLMClient`) so the engine stays decoupled from
 * any specific provider. `OllamaClient` is the default OpenAI-compatible implementation,
 * which also implements the 2c.16 abort fix: a real wall-clock timeout via AbortController,
 * and streaming so a mid-generation abort yields the partial buffer as repair input instead
 * of a hung request.
 *
 * Framework-agnostic; merges into AiTeacher's lib/ unchanged (AiTeacher can inject its own
 * client that resolves the `visual` slot via lib/llm/slots.ts instead of using OllamaClient).
 */
import { DIAGRAM_TYPES, type CourseId, type SubjectId } from "./schema";
import type { Template } from "./registry";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Called with each streamed text chunk (for UI token display). */
  onToken?: (chunk: string) => void;
}

export interface CompleteResult {
  text: string;
  /** True if we returned a partial buffer because the timeout/abort fired mid-stream. */
  truncated: boolean;
}

export interface LLMClient {
  complete(messages: ChatMessage[], opts?: CompleteOptions): Promise<CompleteResult>;
}

export interface OllamaConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

const SCHEMA_DESCRIPTION = `
ConceptDoc JSON schema (output EXACTLY this, nothing else):
{
  "title": string (<=80 chars),
  "summary": string (1-2 plain sentences teaching the concept, <=280 chars),
  "diagramType": one of ${DIAGRAM_TYPES.map((t) => `"${t}"`).join(" | ")},
  "nodes": [{ "id": slug, "label": short string (<=60), "kind"?: "box"|"ellipse"|"pill"|"card", "note"?: string (<=160) }],
  "edges": [{ "from": id, "to": id, "label"?: string (<=40), "kind"?: "solid"|"dashed"|"bidir" }],
  "groups"?: [{ "id": slug, "label"?: string, "members": [ids] }],
  "steps"?: [{ "id": slug, "label": string, "at": number }],  // required for "timeline", ordered by at
  "subject"?: "cs"|"physics"|"materials"|"chemistry"|"biology"|"medicine"|"linguistics"|"law"|"economics"|"history"|"psychology"|"generic",
  "course"?: string,    // e.g. "cs.prog1"
  "template"?: string,  // one of the template ids listed below
  "domain"?: object     // per-template structured data described in each template's rules
}
Rules:
- Node ids are short slugs (a-z, 0-9, _, -, :). Keep <= 12 nodes.
- NEVER output coordinates, x, y, width, height, or pixel values. Layout is handled elsewhere.
- Every edge.from and edge.to must reference an existing node id. Every group member must exist.
- Choose the diagramType AND template that best match the concept from the menu below. Set
  subject/course/template to match. If none of the specific templates fit, use a generic.* one.
- Fill the "domain" object with ONLY the keys the chosen template's rules describe.
- Output ONLY a single JSON object. No prose, no markdown fences, no commentary.`.trim();

/** Select up to `limit` few-shots: prefer course-specific templates, then generic. */
function selectFewShots(templates: Template[], limit = 2): Template[] {
  const course = templates.filter((t) => t.subject !== "generic" && t.fewShot);
  const generic = templates.filter((t) => t.subject === "generic" && t.fewShot);
  return [...course, ...generic].slice(0, limit);
}

function templateMenu(templates: Template[]): string {
  return templates
    .map((t) => `  - ${t.id}: ${t.description}\n    rules: ${t.promptFragment}`)
    .join("\n");
}

/**
 * Build the system prompt for a route. Lists the active course/subject templates plus the
 * generic fallbacks, with each template's when-to-choose description and rules. The model
 * self-declares subject/course/template in its JSON.
 */
export function buildSystemPrompt(templates: Template[], route?: { subject: SubjectId; course?: CourseId }): string {
  const routeLine = route?.course
    ? `The user is studying the course "${route.course}" (subject "${route.subject}"). Prefer a template from that course when it fits.`
    : route?.subject && route.subject !== "generic"
      ? `The user is studying subject "${route.subject}". Prefer a subject-specific template when it fits.`
      : `No specific course is active — choose the best-fitting template from the menu.`;
  return `You are a study-visualization author for a learning platform.
Your job: take a concept or question and produce a JSON "ConceptDoc" that a deterministic layout+render engine will turn into a hand-drawn study diagram.

Think like a teacher. First decide how you would EXPLAIN the concept in one or two plain sentences (this becomes "summary"). Then choose the single best template (and matching diagramType) and a small set of nodes + labeled edges that capture the STRUCTURE of the concept — not every detail. Good study diagrams are sparse and readable: prefer fewer, well-labeled nodes over completeness.

${routeLine}

Available templates (choose ONE — its id goes in "template"):
${templateMenu(templates)}

${SCHEMA_DESCRIPTION}

If the user's request is ambiguous, make a reasonable choice rather than asking. Always output valid JSON only.`;
}

export interface BuildMessagesOptions {
  templates?: Template[];
  route?: { subject: SubjectId; course?: CourseId };
  repairErrors?: string[];
}

export function buildMessages(query: string, opts: BuildMessagesOptions = {}): ChatMessage[] {
  const { templates = [], route, repairErrors } = opts;
  const system = templates.length
    ? buildSystemPrompt(templates, route)
    : `You are a study-visualization author for a learning platform.\n\n${SCHEMA_DESCRIPTION}\n\nIf the user's request is ambiguous, make a reasonable choice rather than asking. Always output valid JSON only.`;
  const msgs: ChatMessage[] = [{ role: "system", content: system }];
  for (const t of selectFewShots(templates)) {
    msgs.push({ role: "user", content: t.fewShot!.query });
    msgs.push({ role: "assistant", content: JSON.stringify(t.fewShot!.doc, null, 0) });
  }
  msgs.push({ role: "user", content: query });
  if (repairErrors && repairErrors.length) {
    msgs.push({
      role: "assistant",
      content:
        "{ \"ack\": \"producing ConceptDoc JSON\" } // my previous output was invalid; I will fix it",
    });
    msgs.push({
      role: "user",
      content: `Your previous output failed validation with these errors:\n- ${repairErrors.join("\n- ")}\n\nOutput a CORRECTED ConceptDoc JSON object now, following the schema exactly. Output only JSON.`,
    });
  }
  return msgs;
}

/**
 * OpenAI-compatible client (Ollama cloud/local). Streams so an abort yields a partial buffer.
 * The 2c.16 fix: a wall-clock setTimeout aborts the fetch at timeoutMs; we resolve with the
 * text accumulated so far (truncated=true) instead of rejecting. The caller feeds that partial
 * text into the repair path — so a slow model never blocks beyond the budget.
 */
export class OllamaClient implements LLMClient {
  constructor(private cfg: OllamaConfig) {}

  async complete(
    messages: ChatMessage[],
    opts: CompleteOptions = {},
  ): Promise<CompleteResult> {
    const { signal, timeoutMs = 20000, onToken } = opts;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    // If the caller's signal aborts, propagate.
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
    }

    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.cfg.model,
          messages,
          stream: true,
          temperature: 0.4,
        }),
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      // Network error or abort before response: return empty truncated rather than throw,
      // so the repair loop can still produce a fallback doc.
      if (ctrl.signal.aborted) return { text: "", truncated: true };
      throw new Error(`Ollama request failed: ${(err as Error).message}`);
    }

    if (!res.ok || !res.body) {
      clearTimeout(timer);
      const bodyText = await res.text().catch(() => "");
      throw new Error(`Ollama HTTP ${res.status}: ${bodyText.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let truncated = false;

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload);
            const delta: string | undefined = json?.choices?.[0]?.delta?.content;
            if (delta) {
              text += delta;
              onToken?.(delta);
            }
          } catch {
            // partial JSON across chunks — ignore, will be completed on next read
          }
        }
      }
    } catch (err) {
      if (ctrl.signal.aborted) truncated = true;
      else {
        clearTimeout(timer);
        throw err;
      }
    } finally {
      clearTimeout(timer);
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }

    return { text, truncated };
  }
}

/**
 * Run the decompose stage once. Returns the raw model text (which should be a JSON string,
 * possibly with surrounding prose/fences — the repair loop strips and parses it). Callers
 * normally go through repair.ts instead of calling this directly.
 */
export async function decompose(
  query: string,
  client: LLMClient,
  opts: CompleteOptions & BuildMessagesOptions = {},
): Promise<CompleteResult> {
  const { templates, route, repairErrors, ...completeOpts } = opts;
  const messages = buildMessages(query, { templates, route, repairErrors });
  return client.complete(messages, completeOpts);
}

/**
 * Strip markdown fences and leading/trailing prose, then JSON.parse. Returns {json} or
 * {error}. Tolerates the model wrapping JSON in ```json … ``` or adding a sentence after.
 */
export function extractJson(text: string): { ok: true; json: unknown } | { ok: false; error: string } {
  if (!text.trim()) return { ok: false, error: "empty model output" };
  // Try direct parse first.
  let candidate = text.trim();
  const fenceMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) candidate = fenceMatch[1].trim();
  // If still has prose, grab the outermost { ... } block.
  if (!candidate.startsWith("{")) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) candidate = candidate.slice(start, end + 1);
  }
  try {
    return { ok: true, json: JSON.parse(candidate) };
  } catch (err) {
    return { ok: false, error: `JSON parse failed: ${(err as Error).message}` };
  }
}