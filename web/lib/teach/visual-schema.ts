import { z } from "zod";

// These names are the long-lived contract between the visual-director model,
// renderer, and the asset dataset the user will add later. Keep them semantic:
// renderer implementations and concrete asset filenames may change beneath
// this layer without changing model output.
export const VISUAL_ACTION_NAMES = [
  "place_asset",
  "write_label",
  "draw_arrow",
  "draw_architecture",
  "draw_diagram",
  "arrange_layout",
  "group_elements",
  "emphasize",
] as const;

// Auto-layout diagram types the mathwriter engine renders deterministically
// ([G]{...} markup). The director emits these instead of authoring geometry:
// layout, sizing, and routing are the engine's job and cannot overlap.
export const G_DIAGRAM_TYPES = [
  "sequence",
  "er_diagram",
  "tree",
  "array",
  "graph",
  "linked_list",
  "stack",
  "queue",
  "dp_table",
  "memory",
] as const;

export type VisualActionName = (typeof VISUAL_ACTION_NAMES)[number];

const elementIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(
    /^[A-Za-z][A-Za-z0-9._:-]*$/,
    "Use a stable element id beginning with a letter and containing only letters, numbers, '.', '_', ':', or '-'.",
  );

// Asset IDs deliberately allow path-like namespaces. A future dataset can use
// names such as `characters/teacher-thinking` or `arrows/curved-left` without a
// schema migration. Validation never rewrites an asset ID.
export const visualAssetIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    "Use a dataset key containing only letters, numbers, '.', '_', ':', '/', or '-'.",
  );

export const visualCueSchema = z
  .object({
    segmentId: elementIdSchema.describe(
      "The transcript segment that should trigger this visual action.",
    ),
    timing: z.enum(["before", "during", "after"]).default("during"),
  })
  .strict();

const cueField = { cue: visualCueSchema.optional() };

export const placeAssetActionSchema = z
  .object({
    action: z.literal("place_asset"),
    id: elementIdSchema,
    assetId: visualAssetIdSchema.describe(
      "Exact stable key from the provided asset catalog. Unknown keys are preserved for forward compatibility.",
    ),
    label: z.string().min(1).max(100).optional(),
    size: z.enum(["small", "medium", "large", "hero"]).default("medium"),
    anchor: z
      .object({
        target: elementIdSchema.optional(),
        side: z.enum(["auto", "above", "right", "below", "left", "center"]).default("auto"),
        align: z.enum(["start", "center", "end"]).default("center"),
      })
      .strict()
      .optional(),
    ...cueField,
  })
  .strict();

export const writeLabelActionSchema = z
  .object({
    action: z.literal("write_label"),
    id: elementIdSchema,
    text: z.string().min(1).max(180),
    role: z.enum(["title", "concept", "caption", "note", "equation"]).default("concept"),
    tone: z.enum(["neutral", "primary", "success", "warning", "danger"]).default("neutral"),
    anchor: z
      .object({
        target: elementIdSchema.optional(),
        side: z.enum(["auto", "above", "right", "below", "left", "center"]).default("auto"),
      })
      .strict()
      .optional(),
    ...cueField,
  })
  .strict();

export const drawArrowActionSchema = z
  .object({
    action: z.literal("draw_arrow"),
    id: elementIdSchema,
    from: elementIdSchema,
    to: elementIdSchema,
    label: z.string().min(1).max(80).optional(),
    relationship: z
      .enum(["flow", "dependency", "causation", "comparison", "association"])
      .default("flow"),
    path: z.enum(["straight", "curved", "elbow"]).default("curved"),
    direction: z.enum(["forward", "both", "none"]).default("forward"),
    tone: z.enum(["neutral", "primary", "success", "warning", "danger"]).default("primary"),
    ...cueField,
  })
  .strict();

const architectureNodeSchema = z
  .object({
    id: elementIdSchema,
    label: z.string().min(1).max(100),
    kind: z.enum(["input", "process", "decision", "store", "output", "concept"]).default("concept"),
    assetId: visualAssetIdSchema.optional(),
  })
  .strict();

const architectureEdgeSchema = z
  .object({
    from: elementIdSchema,
    to: elementIdSchema,
    label: z.string().min(1).max(80).optional(),
    relationship: z
      .enum(["flow", "dependency", "causation", "comparison", "association"])
      .default("flow"),
    direction: z.enum(["forward", "both", "none"]).default("forward"),
  })
  .strict();

export const drawArchitectureActionSchema = z
  .object({
    action: z.literal("draw_architecture"),
    id: elementIdSchema,
    title: z.string().min(1).max(120).optional(),
    nodes: z.array(architectureNodeSchema).min(2).max(12),
    edges: z.array(architectureEdgeSchema).max(20).default([]),
    layout: z.enum(["layered", "tree", "radial", "flow"]).default("layered"),
    direction: z.enum(["left_to_right", "top_to_bottom"]).default("left_to_right"),
    ...cueField,
  })
  .strict();

// A whole diagram delegated to the handwriting engine's auto-layout: the
// director says WHAT to show (actors, steps, entities…), the engine decides
// WHERE every stroke goes. Renders as real handwriting via [G] markup.
export const drawDiagramActionSchema = z
  .object({
    action: z.literal("draw_diagram"),
    id: elementIdSchema,
    title: z.string().min(1).max(120).optional(),
    // Size is enforced in validateVisualPlan (a refine here would break the
    // discriminated union).
    spec: z.object({ type: z.enum(G_DIAGRAM_TYPES) }).passthrough(),
    ...cueField,
  })
  .strict();

export const arrangeLayoutActionSchema = z
  .object({
    action: z.literal("arrange_layout"),
    id: elementIdSchema,
    targets: z.array(elementIdSchema).min(1).max(20),
    preset: z.enum(["row", "column", "grid", "radial", "hierarchy", "timeline"]),
    direction: z.enum(["left_to_right", "right_to_left", "top_to_bottom", "bottom_to_top"]).default("left_to_right"),
    spacing: z.enum(["compact", "normal", "airy"]).default("normal"),
    ...cueField,
  })
  .strict();

export const groupElementsActionSchema = z
  .object({
    action: z.literal("group_elements"),
    id: elementIdSchema,
    targets: z.array(elementIdSchema).min(2).max(20),
    label: z.string().min(1).max(100).optional(),
    style: z.enum(["boundary", "background", "brace"]).default("boundary"),
    tone: z.enum(["neutral", "primary", "success", "warning", "danger"]).default("neutral"),
    ...cueField,
  })
  .strict();

export const emphasizeActionSchema = z
  .object({
    action: z.literal("emphasize"),
    id: elementIdSchema,
    target: elementIdSchema,
    style: z.enum(["spotlight", "outline", "underline", "pulse", "dim_others"]),
    tone: z.enum(["primary", "success", "warning", "danger"]).default("primary"),
    label: z.string().min(1).max(80).optional(),
    ...cueField,
  })
  .strict();

export const visualActionSchema = z.discriminatedUnion("action", [
  placeAssetActionSchema,
  writeLabelActionSchema,
  drawArrowActionSchema,
  drawArchitectureActionSchema,
  drawDiagramActionSchema,
  arrangeLayoutActionSchema,
  groupElementsActionSchema,
  emphasizeActionSchema,
]);

export const visualPlanSchema = z
  .object({
    version: z.literal(1),
    sceneId: elementIdSchema,
    summary: z.string().min(1).max(240).optional(),
    actions: z.array(visualActionSchema).max(32),
  })
  .strict();

export const visualPlanningInputSchema = z
  .object({
    lessonId: elementIdSchema.optional(),
    topic: z.string().min(1).max(160),
    objective: z.string().min(1).max(320).optional(),
    segments: z
      .array(
        z
          .object({
            id: elementIdSchema,
            text: z.string().min(1).max(1200),
            boardElementIds: z.array(elementIdSchema).max(20).default([]),
          })
          .strict(),
      )
      .max(64)
      .default([]),
    boardElements: z
      .array(
        z
          .object({
            id: elementIdSchema,
            label: z.string().min(1).max(180),
            kind: z.enum(["text", "equation", "code", "image", "diagram", "concept"]),
            assetId: visualAssetIdSchema.optional(),
          })
          .strict(),
      )
      .max(64)
      .default([]),
    relationships: z
      .array(
        z
          .object({
            from: elementIdSchema,
            to: elementIdSchema,
            label: z.string().min(1).max(80).optional(),
            relationship: z
              .enum(["flow", "dependency", "causation", "comparison", "association"])
              .default("association"),
          })
          .strict(),
      )
      .max(64)
      .default([]),
    assetCatalog: z
      .array(
        z
          .object({
            id: visualAssetIdSchema,
            label: z.string().min(1).max(100),
            kind: z.enum(["character", "icon", "shape", "arrow", "diagram", "background", "other"]),
            tags: z.array(z.string().min(1).max(40)).max(20).default([]),
          })
          .strict(),
      )
      .max(500)
      .default([]),
  })
  .strict();

export type VisualCue = z.infer<typeof visualCueSchema>;
export type VisualAction = z.infer<typeof visualActionSchema>;
export type VisualPlan = z.infer<typeof visualPlanSchema>;
export type VisualPlanningInput = z.infer<typeof visualPlanningInputSchema>;

// A function-calling model may expose one tool per stable action name. These
// are the corresponding argument schemas (the tool name supplies `action`).
// A one-shot planner can instead emit visualPlanSchema directly.
export const visualFunctionInputSchemas = {
  place_asset: placeAssetActionSchema.omit({ action: true }),
  write_label: writeLabelActionSchema.omit({ action: true }),
  draw_arrow: drawArrowActionSchema.omit({ action: true }),
  draw_architecture: drawArchitectureActionSchema.omit({ action: true }),
  draw_diagram: drawDiagramActionSchema.omit({ action: true }),
  arrange_layout: arrangeLayoutActionSchema.omit({ action: true }),
  group_elements: groupElementsActionSchema.omit({ action: true }),
  emphasize: emphasizeActionSchema.omit({ action: true }),
} as const;

export function visualActionFromFunctionCall(
  name: string,
  input: unknown,
): VisualAction | null {
  if (!(VISUAL_ACTION_NAMES as readonly string[]).includes(name)) return null;
  const parsed = visualActionSchema.safeParse({
    ...(typeof input === "object" && input !== null ? input : {}),
    action: name,
  });
  return parsed.success ? parsed.data : null;
}
