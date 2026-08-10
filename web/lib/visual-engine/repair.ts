/**
 * Stage 1 orchestration: decompose -> parse -> validate -> (repair up to N times) -> fallback.
 *
 * The contract: `produceDoc` ALWAYS resolves to a ConceptDoc. It never throws and never blocks
 * beyond the timeout budget (the OllamaClient abort fix returns a truncated partial buffer,
 * which we feed back through coerce/repair rather than hanging). This is the engine's answer
 * to "unreliable / breaks often": every failure degrades to a usable doc instead of an error.
 */
import {
  type ConceptDoc,
  type CourseId,
  type SubjectId,
  coerceToDoc,
  fallbackDoc,
  validate,
} from "./schema";
import {
  type CompleteOptions,
  type LLMClient,
  decompose,
  extractJson,
} from "./decompose";
import {
  type Route,
  type RouteHint,
  classifySubject,
  courseSubject,
  templateCourse,
} from "./subjects";
import { getTemplates, type Template } from "./registry";

export interface ProduceOptions extends CompleteOptions {
  /** Max repair rounds after the first attempt (default 2). */
  maxRepairs?: number;
  /** Notified of each attempt and its outcome (for UI status). */
  onStatus?: (s: ProduceStatus) => void;
  /** Override the subject/course route (UI selector or AiTeacher active course). */
  courseHint?: CourseId;
  subjectHint?: SubjectId;
}

export type ProduceStatus =
  | { stage: "decompose"; attempt: number }
  | { stage: "truncated"; attempt: number }
  | { stage: "repair"; attempt: number; errors: string[] }
  | { stage: "reroute"; attempt: number; course: CourseId }
  | { stage: "coerced"; attempt: number }
  | { stage: "fallback"; reason: string };

export interface ProduceResult {
  doc: ConceptDoc;
  attempts: number;
  repaired: boolean;
  fellBack: boolean;
  truncated: boolean;
  route: Route;
}

/** Fill missing subject/course on a doc from the active route (template is the model's choice). */
function fillRoute(doc: ConceptDoc, route: Route): ConceptDoc {
  return {
    ...doc,
    subject: doc.subject ?? route.subject,
    course: doc.course ?? route.course,
  };
}

export async function produceDoc(
  query: string,
  client: LLMClient,
  opts: ProduceOptions = {},
): Promise<ProduceResult> {
  const { maxRepairs = 2, onStatus, courseHint, subjectHint, ...completeOpts } = opts;
  let attempts = 0;
  let truncated = false;
  let lastErrors: string[] = [];

  // Route -> template set. Generic templates are always included (fallback pack).
  const hint: RouteHint = { course: courseHint, subject: subjectHint };
  let route = classifySubject(query, hint);
  let templates: Template[] = getTemplates(route.course, route.subject);
  let rerouted = false;

  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    attempts = attempt + 1;
    onStatus?.({ stage: "decompose", attempt });
    const repairErrors = attempt === 0 ? undefined : lastErrors;
    const result = await decompose(query, client, {
      ...completeOpts,
      templates,
      route,
      repairErrors,
    });
    if (result.truncated) {
      truncated = true;
      onStatus?.({ stage: "truncated", attempt });
    }

    const parsed = extractJson(result.text);
    if (!parsed.ok) {
      lastErrors = [parsed.error];
      if (attempt < maxRepairs) {
        onStatus?.({ stage: "repair", attempt: attempt + 1, errors: lastErrors });
        continue;
      }
      break;
    }

    // Reroute: if the model self-declared a different course with its own templates, swap to
    // that course's pack for the next attempt (counts as one repair attempt).
    if (!rerouted && parsed.ok) {
      const json = parsed.json as Record<string, unknown>;
      const declaredCourse = typeof json.course === "string" ? (json.course as CourseId) : undefined;
      const declaredTemplate = typeof json.template === "string" ? (json.template as string) : undefined;
      const modelCourse = declaredCourse ?? templateCourse(declaredTemplate);
      if (modelCourse && modelCourse !== route.course) {
        const swapped = getTemplates(modelCourse, courseSubject(modelCourse));
        if (swapped.some((t) => t.course === modelCourse)) {
          route = { subject: courseSubject(modelCourse), course: modelCourse };
          templates = swapped;
          rerouted = true;
          onStatus?.({ stage: "reroute", attempt, course: modelCourse });
          lastErrors = [`rerouting to course ${modelCourse}`];
          continue;
        }
      }
    }

    // Try the model's JSON directly.
    const v = validate(parsed.json);
    if (v.ok) {
      return {
        doc: fillRoute(v.doc, route),
        attempts,
        repaired: attempt > 0,
        fellBack: false,
        truncated,
        route,
      };
    }

    // Try a deterministic coerce (strip bad refs/keys, relax diagramType) before spending
    // another model call — often the model was 90% right.
    const coerced = coerceToDoc(parsed.json);
    if (coerced) {
      onStatus?.({ stage: "coerced", attempt });
      return {
        doc: fillRoute(coerced, route),
        attempts,
        repaired: true,
        fellBack: false,
        truncated,
        route,
      };
    }

    lastErrors = v.errors;
    if (attempt < maxRepairs) {
      onStatus?.({ stage: "repair", attempt: attempt + 1, errors: lastErrors });
      continue;
    }
    break;
  }

  // Exhausted — degrade gracefully.
  const reason = truncated
    ? "model timed out before completing valid JSON"
    : `could not validate after ${attempts} attempt(s): ${lastErrors.join("; ")}`;
  onStatus?.({ stage: "fallback", reason });
  return {
    doc: fallbackDoc(query),
    attempts,
    repaired: false,
    fellBack: true,
    truncated,
    route,
  };
}