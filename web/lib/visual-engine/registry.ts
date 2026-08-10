/**
 * Template registry — the heart of the subject-aware engine.
 *
 * A Template binds a course/subject to: a when-to-choose description + prompt fragment (injected
 * into the Stage-1 prompt), an optional few-shot, an optional post-hoc domain schema, an optional
 * node budget, and a deterministic layout (Stage 2). Pack modules call `registerTemplate()` at
 * module load; `index.ts` side-effect-imports the packs so they self-register.
 *
 * Layout/render stay deterministic code; the registry just routes a ConceptDoc to the right
 * layout + render primitives. `layout()` falls back to the diagramType switch when a doc has no
 * `template` or an unknown one, so the generic engine keeps working unchanged.
 *
 * Framework-agnostic; merges into AiTeacher's lib/ unchanged.
 */
import type { z } from "zod";
import type { ConceptDoc, CourseId, SubjectId, TemplateId } from "./schema";
import type { PositionedGraph } from "./layout";

export interface TemplateFewShot {
  query: string;
  doc: unknown; // a ConceptDoc-shaped object (kept loose to avoid import cycles)
}

export interface Template {
  id: TemplateId;
  /** Course this template belongs to, if course-scoped (e.g. "cs.prog1"). */
  course?: CourseId;
  /** Subject ("cs") or "generic" for fallback templates. */
  subject: SubjectId | "generic";
  label: string;
  /** When-to-choose — injected into the prompt menu. */
  description: string;
  /** Template rules + domain-field instructions injected into the prompt. */
  promptFragment: string;
  /** ONE compact example (query + doc). At most ~2 few-shots per call. */
  fewShot?: TemplateFewShot;
  /** Optional post-hoc validation of the `domain` field (failure -> repair round). */
  domainSchema?: z.ZodType;
  /** Override the default node budget (14) in the prompt. */
  nodeBudget?: number;
  /** Deterministic Stage-2 layout. */
  layout: (doc: ConceptDoc) => PositionedGraph;
}

const TEMPLATE_REGISTRY = new Map<TemplateId, Template>();

/** Register a template. Called by pack modules at import time. */
export function registerTemplate(t: Template): void {
  if (TEMPLATE_REGISTRY.has(t.id)) {
    // Idempotent re-import (HMR / SSR): just overwrite.
  }
  TEMPLATE_REGISTRY.set(t.id, t);
}

/** Look up a single template by id, or undefined. */
export function getTemplate(id?: TemplateId): Template | undefined {
  return id ? TEMPLATE_REGISTRY.get(id) : undefined;
}

/** All registered templates (mostly for tests / debugging). */
export function allTemplates(): Template[] {
  return [...TEMPLATE_REGISTRY.values()];
}

/**
 * The template set shown to the model for a given route. Generic templates are ALWAYS included
 * (they are the fallback pack), so a wrong route degrades to a valid generic diagram rather than
 * failure. Course templates are preferred when a course is known; otherwise subject templates.
 */
export function getTemplates(course?: CourseId, subject?: SubjectId): Template[] {
  const courseTmpls: Template[] = [];
  const subjectTmpls: Template[] = [];
  const genericTmpls: Template[] = [];
  for (const t of TEMPLATE_REGISTRY.values()) {
    if (t.subject === "generic") genericTmpls.push(t);
    else if (course && t.course === course) courseTmpls.push(t);
    else if (!course && subject && t.subject === subject && !t.course) subjectTmpls.push(t);
  }
  // Course first (most specific), then subject, then generic fallback.
  return [...courseTmpls, ...subjectTmpls, ...genericTmpls];
}