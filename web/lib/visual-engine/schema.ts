/**
 * ConceptDoc — the intermediate representation (IR) the writing engine is built around.
 *
 * The whole point: the LLM produces ONLY this semantic graph + a diagramType hint. It never
 * emits coordinates, sizes, or pixels. Layout (layout.ts) and rendering (render.ts) are
 * deterministic code. This is what fixes the "LLM guesses positions -> overlaps / wrong /
 * shallow / unreliable" failure mode of the current mathwriter-direct visual pipeline.
 *
 * This file is framework-agnostic and merges into AiTeacher's lib/ unchanged.
 */
import { z } from "zod";

export const DIAGRAM_TYPES = [
  "hierarchy",
  "flow",
  "cycle",
  "timeline",
  "comparison",
  "mindmap",
] as const;
export type DiagramType = (typeof DIAGRAM_TYPES)[number];

export const NODE_KINDS = ["box", "ellipse", "pill", "card"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const EDGE_KINDS = ["solid", "dashed", "bidir"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

/**
 * Subject-wareness. A CourseId is a dotted path whose first segment is the SubjectId
 * (e.g. "cs.prog1", "cs.math2", "cs.hmi3"). Math and HCI are CS-curriculum course sequences,
 * not separate subjects. A TemplateId is a dotted path too: either "<subject>.<name>" for a
 * generic/subject template, or "<course>.<name>" for a course-scoped template
 * (e.g. "generic.flow", "cs.prog1.binaryTree").
 */
export const SUBJECTS = [
  "cs",
  "physics",
  "materials",
  "chemistry",
  "biology",
  "medicine",
  "linguistics",
  "law",
  "economics",
  "history",
  "psychology",
  "generic",
] as const;
export type SubjectId = (typeof SUBJECTS)[number];
export type CourseId = string;
export type TemplateId = string;

/** First segment of a CourseId / TemplateId is the subject. */
export function subjectOf(id: string): SubjectId {
  const head = id.split(".")[0];
  return (SUBJECTS as readonly string[]).includes(head) ? (head as SubjectId) : "generic";
}

/** Course of a TemplateId, if it is course-scoped (e.g. "cs.prog1.binaryTree" -> "cs.prog1"). */
export function courseOfTemplate(template: TemplateId): CourseId | undefined {
  const parts = template.split(".");
  if (parts.length >= 3) return parts.slice(0, 2).join(".");
  // 2-part ids are subject/generic templates (e.g. "generic.flow") -> no course.
  if (parts.length === 2 && subjectOf(template) !== "generic") return undefined;
  return undefined;
}

/**
 * Map a bare diagramType to the generic template id, so a doc with only diagramType (no
 * template) still dispatches through the registry when one is present. The generic pack
 * registers templates with exactly these ids.
 */
export function inferTemplateFromDiagramType(dt: DiagramType): TemplateId {
  return `generic.${dt}`;
}

export const NodeSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9_:-]+$/, "node id must be a simple slug"),
  label: z.string().min(1).max(60),
  kind: z.enum(NODE_KINDS).optional(),
  note: z.string().max(160).optional(),
});

export const EdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().max(40).optional(),
  kind: z.enum(EDGE_KINDS).optional(),
});

export const GroupSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9_:-]+$/, "group id must be a simple slug"),
  label: z.string().max(60).optional(),
  members: z.array(z.string()).min(1),
});

export const StepSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(60),
  at: z.number(),
});

export const ConceptDocSchema = z
  .object({
    title: z.string().min(1).max(80),
    summary: z.string().min(1).max(280),
    diagramType: z.enum(DIAGRAM_TYPES),
    nodes: z.array(NodeSchema).min(1).max(14),
    edges: z.array(EdgeSchema).max(40),
    groups: z.array(GroupSchema).max(8).optional(),
    steps: z.array(StepSchema).max(20).optional(),
    // Subject-awareness (all optional; diagramType stays required as the fallback):
    subject: z.enum(SUBJECTS).optional(),
    course: z.string().max(60).optional(),
    template: z.string().max(80).optional(),
    domain: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((doc, ctx) => {
    const ids = new Set(doc.nodes.map((n) => n.id));
    if (doc.nodes.length > 1 && doc.edges.length === 0 && doc.diagramType !== "mindmap") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "diagram has multiple nodes but no edges; add relationships or use diagramType 'mindmap'",
        path: ["edges"],
      });
    }
    for (const [i, e] of doc.edges.entries()) {
      if (!ids.has(e.from))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `edge ${i} references unknown node "${e.from}"`,
          path: ["edges", i, "from"],
        });
      if (!ids.has(e.to))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `edge ${i} references unknown node "${e.to}"`,
          path: ["edges", i, "to"],
        });
    }
    if (doc.groups) {
      for (const [i, g] of doc.groups.entries()) {
        for (const [j, m] of g.members.entries()) {
          if (!ids.has(m))
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `group ${i} references unknown node "${m}"`,
              path: ["groups", i, "members", j],
            });
        }
      }
    }
    if (doc.diagramType === "timeline" && (!doc.steps || doc.steps.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "timeline diagrams require a non-empty steps[] ordered by `at`",
        path: ["steps"],
      });
    }
  });

export type ConceptDoc = z.infer<typeof ConceptDocSchema>;
export type Node = z.infer<typeof NodeSchema>;
export type Edge = z.infer<typeof EdgeSchema>;
export type Group = z.infer<typeof GroupSchema>;
export type Step = z.infer<typeof StepSchema>;

/** Pull the optional subject/course/template/domain fields off a raw model object. */
function pickSubjectFields(r: Record<string, unknown>): Partial<ConceptDoc> {
  const out: Partial<ConceptDoc> = {};
  const subj = r.subject;
  if (typeof subj === "string" && (SUBJECTS as readonly string[]).includes(subj)) {
    out.subject = subj as SubjectId;
  }
  if (typeof r.course === "string" && r.course) out.course = r.course.slice(0, 60);
  if (typeof r.template === "string" && r.template) out.template = r.template.slice(0, 80);
  if (r.domain !== undefined && r.domain !== null && typeof r.domain === "object") {
    out.domain = r.domain as Record<string, unknown>;
  }
  return out;
}

/** A zod-safe parse that returns {ok, doc, errors} instead of throwing. */
export function validate(raw: unknown):
  | { ok: true; doc: ConceptDoc }
  | { ok: false; errors: string[] } {
  const parsed = ConceptDocSchema.safeParse(raw);
  if (parsed.success) return { ok: true, doc: parsed.data };
  const errors = parsed.error.issues.map(
    (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
  );
  return { ok: false, errors };
}

/**
 * Coerce a model's near-valid output into a ConceptDoc as best we can WITHOUT a model call:
 * strip unknown keys, drop edges/groups that reference missing ids, drop oversized arrays,
 * default diagramType, etc. Used as a pre-step before the (model) repair loop and as the
 * deterministic sanitizer on the final fallback path.
 */
export function coerceToDoc(raw: unknown): ConceptDoc | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const diagramType = DIAGRAM_TYPES.includes(r.diagramType as DiagramType)
    ? (r.diagramType as DiagramType)
    : "mindmap";
  const title = typeof r.title === "string" ? r.title.slice(0, 80) : "Concept";
  const summary = typeof r.summary === "string" ? r.summary.slice(0, 280) : "";
  const rawNodes = Array.isArray(r.nodes) ? r.nodes : [];
  const idSet = new Set<string>();
  const nodes: Node[] = [];
  for (const n of rawNodes) {
    if (typeof n !== "object" || n === null) continue;
    const no = n as Record<string, unknown>;
    const id = typeof no.id === "string" ? no.id : null;
    const label = typeof no.label === "string" ? no.label : null;
    if (!id || !label || idSet.has(id)) continue;
    idSet.add(id);
    const kind = NODE_KINDS.includes(no.kind as NodeKind) ? (no.kind as NodeKind) : undefined;
    const note = typeof no.note === "string" ? no.note.slice(0, 160) : undefined;
    nodes.push({ id, label: label.slice(0, 60), ...(kind ? { kind } : {}), ...(note ? { note } : {}) });
    if (nodes.length >= 14) break;
  }
  if (nodes.length === 0) return null;
  const rawEdges = Array.isArray(r.edges) ? r.edges : [];
  const edges: Edge[] = [];
  for (const e of rawEdges) {
    if (typeof e !== "object" || e === null) continue;
    const eo = e as Record<string, unknown>;
    const from = typeof eo.from === "string" ? eo.from : null;
    const to = typeof eo.to === "string" ? eo.to : null;
    if (!from || !to || !idSet.has(from) || !idSet.has(to)) continue;
    const label = typeof eo.label === "string" ? eo.label.slice(0, 40) : undefined;
    const kind = EDGE_KINDS.includes(eo.kind as EdgeKind) ? (eo.kind as EdgeKind) : undefined;
    edges.push({ from, to, ...(label ? { label } : {}), ...(kind ? { kind } : {}) });
    if (edges.length >= 40) break;
  }
  const rawGroups = Array.isArray(r.groups) ? r.groups : undefined;
  let groups: Group[] | undefined;
  if (rawGroups) {
    groups = [];
    for (const g of rawGroups) {
      if (typeof g !== "object" || g === null) continue;
      const go = g as Record<string, unknown>;
      const id = typeof go.id === "string" ? go.id : null;
      const members = Array.isArray(go.members) ? go.members.filter((m) => idSet.has(m as string)) : [];
      if (!id || members.length === 0) continue;
      const label = typeof go.label === "string" ? go.label.slice(0, 60) : undefined;
      groups.push({ id, members: members as string[], ...(label ? { label } : {}) });
      if (groups.length >= 8) break;
    }
    if (groups.length === 0) groups = undefined;
  }
  const rawSteps = Array.isArray(r.steps) ? r.steps : undefined;
  let steps: Step[] | undefined;
  if (rawSteps && diagramType === "timeline") {
    steps = [];
    for (const s of rawSteps) {
      if (typeof s !== "object" || s === null) continue;
      const so = s as Record<string, unknown>;
      const id = typeof so.id === "string" ? so.id : null;
      const label = typeof so.label === "string" ? so.label : null;
      const at = typeof so.at === "number" ? so.at : null;
      if (!id || !label || at === null) continue;
      steps.push({ id, label: label.slice(0, 60), at });
      if (steps.length >= 20) break;
    }
    steps.sort((a, b) => a.at - b.at);
    if (steps.length === 0) steps = undefined;
  }
  const doc: ConceptDoc = {
    title,
    summary: summary || `A ${diagramType} view of: ${title}`,
    diagramType,
    nodes,
    edges,
    ...(groups ? { groups } : {}),
    ...(steps ? { steps } : {}),
    ...pickSubjectFields(r),
  };
  // Final validate; if the coerce still produced something invalid (e.g. multi-node no-edge
  // non-mindmap), relax to mindmap which permits lone nodes.
  const v = validate(doc);
  if (v.ok) return v.doc;
  const relaxed: ConceptDoc = { ...doc, diagramType: "mindmap" };
  const v2 = validate(relaxed);
  return v2.ok ? v2.doc : null;
}

/** Last-resort single-node doc. Used when repair exhausts retries. Never throws. */
export function fallbackDoc(query: string): ConceptDoc {
  const v = validate({
    title: query.slice(0, 80) || "Concept",
    summary: `Couldn't fully parse the model output for "${query}". Here is the concept as a single node — retry to regenerate.`,
    diagramType: "mindmap",
    nodes: [{ id: "concept", label: query.slice(0, 60) || "Concept", kind: "box" }],
    edges: [],
    subject: "generic",
  });
  // validate cannot fail on this shape, but satisfy the type checker without `any`.
  if (!v.ok) throw new Error("fallbackDoc produced an invalid doc — this is a bug");
  return v.doc;
}