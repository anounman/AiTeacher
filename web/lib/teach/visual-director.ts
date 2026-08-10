import { generateText, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { slotModel } from "@/lib/llm/slots";
import {
  visualPlanSchema,
  visualPlanningInputSchema,
  type VisualAction,
  type VisualPlan,
  type VisualPlanningInput,
} from "./visual-schema";

// Deliberately small tool surface for local models: the model chooses which
// supplied elements/relationships to show, while labels and edge meaning are
// copied deterministically from the reason model's lesson afterward. This is
// both more reliable than a deeply nested plan call and prevents new facts.
const architectureSelectionSchema = z.object({
  id: z.string().describe("A short diagram id"),
  nodeIds: z.array(z.string()).min(2).max(10).describe("Exact board element ids to include"),
  edges: z
    .array(z.object({ from: z.string(), to: z.string() }))
    .max(12)
    .describe("Only exact from/to pairs supplied in relationships"),
  direction: z.enum(["left_to_right", "top_to_bottom"]).optional(),
  cueSegmentId: z.string().optional().describe("Exact supplied segment id"),
});

// The director exists to make the student SEE the lesson, not to restate it:
// a lesson describing events over time (transactions, protocols, two users on
// one document) becomes a sequence diagram — actors and numbered arrows with
// the failure step in red — drawn by the engine's auto-layout.
const diagramColorSchema = z
  .enum(["red", "green", "amber", "violet"])
  .describe(
    "Meaning-bearing color: red = failure/violation, green = correct/committed, amber = warning/waiting/stale, violet = a second actor or alternative path. Omit for ordinary ink.",
  );

const sequenceStorySchema = z.object({
  id: z.string().describe("A short diagram id"),
  actors: z
    .array(
      z.union([
        z.string().min(1).max(40),
        z.object({ name: z.string().min(1).max(40), color: diagramColorSchema.optional() }),
      ]),
    )
    .min(2)
    .max(4)
    .describe(
      "The players in the story, e.g. [{\"name\":\"Alice\",\"color\":\"green\"}, \"Doc (shared)\", {\"name\":\"Bob\",\"color\":\"violet\"}]. Give each human/process actor its own color so the student can follow one lane at a glance.",
    ),
  steps: z
    .array(
      z.object({
        from: z.string().optional().describe("Acting actor (arrow start)"),
        to: z.string().optional().describe("Receiving actor (arrow end)"),
        actor: z.string().optional().describe("For a note pinned to one actor's lane"),
        label: z.string().min(1).max(90).describe("What happens, condensed from the lesson"),
        color: diagramColorSchema.optional(),
        alert: z.boolean().optional().describe("true = the failure/anomaly moment, drawn red with an X"),
      }),
    )
    .min(2)
    .max(8)
    .describe("The story in order, top to bottom"),
  cueSegmentId: z.string().optional().describe("Exact supplied segment id this illustrates"),
});

export const VISUAL_DIRECTOR_SYSTEM_PROMPT = `You are the visual director for a live lesson. Make exactly one tool call.
If the lesson tells a story over time — actors doing things in order (transactions, users editing a document, requests between machines, a race or deadlock) — call draw_sequence and condense that story into steps, marking the failure moment with alert:true.
USE COLOR TO CARRY MEANING, never for decoration: give each actor its own color so a lane is followable at a glance, and color the steps — green for the correct/committed action, amber for stale or waiting, red for the violation, violet for the second actor's path. A diagram in one flat color makes the student hunt for what matters.
Otherwise call draw_architecture, using only exact board element IDs, relationship pairs, and segment IDs from the supplied JSON.
Step labels must condense sentences from the supplied segments — never invent facts, numbers, or names. Do not answer with text.`;

export type VisualPlanIssueCode =
  | "invalid_plan"
  | "duplicate_id"
  | "unknown_reference"
  | "unknown_segment"
  | "unknown_asset"
  | "invalid_architecture_edge"
  | "empty_plan"
  | "generation_failed"
  | "fallback_failed";

export interface VisualPlanIssue {
  code: VisualPlanIssueCode;
  message: string;
  actionId?: string;
}

export interface VisualPlanValidation {
  plan: VisualPlan | null;
  issues: VisualPlanIssue[];
}

export interface VisualPlanningResult {
  plan: VisualPlan;
  source: "model" | "fallback";
  issues: VisualPlanIssue[];
}

export interface VisualPlanningOptions {
  model?: LanguageModel;
  abortSignal?: AbortSignal;
  // Test/integration seam. A route may also inject a queue-backed generator
  // while preserving the same validated renderer contract.
  generate?: (request: {
    model: LanguageModel;
    input: VisualPlanningInput;
    system: string;
    abortSignal?: AbortSignal;
  }) => Promise<unknown>;
}

function withoutInvalidCue(
  action: VisualAction,
  segmentIds: ReadonlySet<string>,
  issues: VisualPlanIssue[],
): VisualAction {
  if (!action.cue || segmentIds.has(action.cue.segmentId)) return action;
  issues.push({
    code: "unknown_segment",
    actionId: action.id,
    message: `Removed cue to unknown transcript segment "${action.cue.segmentId}".`,
  });
  const rest = { ...action };
  delete rest.cue;
  return rest;
}

function warnForUnknownAsset(
  assetId: string | undefined,
  actionId: string,
  knownAssets: ReadonlySet<string>,
  catalogProvided: boolean,
  issues: VisualPlanIssue[],
): void {
  // Preserve unknown keys: the dataset is intentionally extensible and may be
  // deployed independently. Renderers can show the action's label as a generic
  // fallback until the corresponding asset arrives.
  if (!assetId || !catalogProvided || knownAssets.has(assetId)) return;
  issues.push({
    code: "unknown_asset",
    actionId,
    message: `Asset "${assetId}" is not in this request's catalog; the key was preserved for forward compatibility.`,
  });
}

function uniqueKnownTargets(targets: string[], known: ReadonlySet<string>): string[] {
  return [...new Set(targets.filter((target) => known.has(target)))];
}

// Schema validation protects the renderer from malformed calls; this second
// pass verifies cross-action references, execution ordering, cue IDs, and
// architecture-local edges. Invalid commands are removed independently so one
// model mistake does not erase an otherwise useful plan.
export function validateVisualPlan(
  candidate: unknown,
  inputValue: VisualPlanningInput,
): VisualPlanValidation {
  const parsed = visualPlanSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      plan: null,
      issues: [
        {
          code: "invalid_plan",
          message: parsed.error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join(".") || "plan"}: ${issue.message}`)
            .join("; "),
        },
      ],
    };
  }

  const input = visualPlanningInputSchema.parse(inputValue);
  const segmentIds = new Set(input.segments.map((segment) => segment.id));
  const knownAssets = new Set(input.assetCatalog.map((asset) => asset.id));
  const knownElements = new Set(input.boardElements.map((element) => element.id));
  const usedIds = new Set(knownElements);
  const actions: VisualAction[] = [];
  const issues: VisualPlanIssue[] = [];

  for (const rawAction of parsed.data.actions) {
    if (usedIds.has(rawAction.id)) {
      issues.push({
        code: "duplicate_id",
        actionId: rawAction.id,
        message: `Dropped action with duplicate id "${rawAction.id}".`,
      });
      continue;
    }

    let action = withoutInvalidCue(rawAction, segmentIds, issues);

    if (action.action === "place_asset" || action.action === "write_label") {
      const target = action.anchor?.target;
      if (target && !knownElements.has(target)) {
        issues.push({
          code: "unknown_reference",
          actionId: action.id,
          message: `Removed placement anchor to unknown element "${target}".`,
        });
        action = {
          ...action,
          anchor: action.anchor ? { ...action.anchor, target: undefined } : undefined,
        } as VisualAction;
      }
      if (action.action === "place_asset") {
        warnForUnknownAsset(
          action.assetId,
          action.id,
          knownAssets,
          input.assetCatalog.length > 0,
          issues,
        );
      }
    } else if (action.action === "draw_arrow") {
      if (!knownElements.has(action.from) || !knownElements.has(action.to)) {
        issues.push({
          code: "unknown_reference",
          actionId: action.id,
          message: `Dropped arrow whose endpoints are not available when it executes ("${action.from}" -> "${action.to}").`,
        });
        continue;
      }
    } else if (action.action === "draw_architecture") {
      const nodeIds = new Set<string>();
      let duplicateNode: string | undefined;
      for (const node of action.nodes) {
        if (nodeIds.has(node.id) || usedIds.has(node.id) || node.id === action.id) {
          duplicateNode = node.id;
          break;
        }
        nodeIds.add(node.id);
        warnForUnknownAsset(
          node.assetId,
          action.id,
          knownAssets,
          input.assetCatalog.length > 0,
          issues,
        );
      }
      if (duplicateNode) {
        issues.push({
          code: "duplicate_id",
          actionId: action.id,
          message: `Dropped architecture containing duplicate node id "${duplicateNode}".`,
        });
        continue;
      }
      const edges = action.edges.filter((edge) => {
        const valid = nodeIds.has(edge.from) && nodeIds.has(edge.to);
        if (!valid) {
          issues.push({
            code: "invalid_architecture_edge",
            actionId: action.id,
            message: `Dropped architecture edge with unknown local endpoint ("${edge.from}" -> "${edge.to}").`,
          });
        }
        return valid;
      });
      action = { ...action, edges };
    } else if (action.action === "draw_diagram") {
      // The engine auto-lays these out; here we only bound the payload.
      if (JSON.stringify(action.spec).length > 4000) {
        issues.push({
          code: "invalid_plan",
          actionId: action.id,
          message: "Dropped oversized diagram spec.",
        });
        continue;
      }
    } else if (action.action === "arrange_layout") {
      const targets = uniqueKnownTargets(action.targets, knownElements);
      if (targets.length === 0) {
        issues.push({
          code: "unknown_reference",
          actionId: action.id,
          message: "Dropped layout because none of its targets exist yet.",
        });
        continue;
      }
      action = { ...action, targets };
    } else if (action.action === "group_elements") {
      const targets = uniqueKnownTargets(action.targets, knownElements);
      if (targets.length < 2) {
        issues.push({
          code: "unknown_reference",
          actionId: action.id,
          message: "Dropped group because fewer than two targets exist yet.",
        });
        continue;
      }
      action = { ...action, targets };
    } else if (action.action === "emphasize") {
      if (!knownElements.has(action.target)) {
        issues.push({
          code: "unknown_reference",
          actionId: action.id,
          message: `Dropped emphasis of unknown element "${action.target}".`,
        });
        continue;
      }
    }

    actions.push(action);
    usedIds.add(action.id);
    knownElements.add(action.id);
    if (action.action === "draw_architecture") {
      for (const node of action.nodes) {
        usedIds.add(node.id);
        knownElements.add(node.id);
      }
    }
  }

  const sanitized = visualPlanSchema.parse({ ...parsed.data, actions });
  return { plan: sanitized, issues };
}

function safeIdPart(value: string): string {
  const part = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return part || "lesson";
}

// Lesson text (board markup, objectives) is unbounded, but the plan schema
// caps every rendered string. Clamp at the boundary: a truncated label still
// renders, whereas an over-long one makes the whole plan fail to parse — and
// when that happens inside the fallback there is nothing left to fall back to.
function clamp<T extends string | undefined>(value: T, max: number): T {
  if (value === undefined) return value;
  const text = value.trim();
  return (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`) as T;
}

// Last resort when even the deterministic fallback cannot produce a valid
// plan: a scene with no actions, which renders as nothing at all.
function emptyVisualPlan(input: VisualPlanningInput): VisualPlan {
  return visualPlanSchema.parse({
    version: 1,
    sceneId: `visual-${safeIdPart(input.lessonId ?? input.topic)}-scene`,
    summary: "No visual scene available for this lesson.",
    actions: [],
  });
}

// Deterministic, fact-preserving fallback used when Ollama is offline, rejects
// structured output, or produces no executable actions. It only rearranges or
// restates elements/relationships already supplied by the teaching layer.
export function fallbackVisualPlan(inputValue: VisualPlanningInput): VisualPlan {
  const input = visualPlanningInputSchema.parse(inputValue);
  const prefix = `visual-${safeIdPart(input.lessonId ?? input.topic)}`;
  const cue = input.segments[0]
    ? { segmentId: input.segments[0].id, timing: "during" as const }
    : undefined;
  const actions: VisualAction[] = [
    {
      action: "write_label",
      id: `${prefix}-title`,
      text: clamp(input.topic, 180),
      role: "title",
      tone: "primary",
      ...(cue ? { cue } : {}),
    },
  ];

  const boardIds = new Set(input.boardElements.map((element) => element.id));
  const usableRelationships = input.relationships.filter(
    (relationship) =>
      boardIds.has(relationship.from) && boardIds.has(relationship.to),
  );
  const architectureElements = input.boardElements.slice(0, 8);

  if (architectureElements.length >= 2 && usableRelationships.length > 0) {
    const nodeIdByBoardId = new Map(
      architectureElements.map((element, index) => [
        element.id,
        `${prefix}-node-${index + 1}`,
      ]),
    );
    const edges = usableRelationships
      .filter(
        (relationship) =>
          nodeIdByBoardId.has(relationship.from) &&
          nodeIdByBoardId.has(relationship.to),
      )
      .slice(0, 12)
      .map((relationship) => ({
        from: nodeIdByBoardId.get(relationship.from)!,
        to: nodeIdByBoardId.get(relationship.to)!,
        ...(relationship.label ? { label: clamp(relationship.label, 80) } : {}),
        relationship: relationship.relationship,
        direction: "forward" as const,
      }));
    actions.push({
      action: "draw_architecture",
      id: `${prefix}-architecture`,
      title: clamp(input.objective, 120),
      nodes: architectureElements.map((element) => ({
        id: nodeIdByBoardId.get(element.id)!,
        label: clamp(element.label, 100),
        kind: "concept" as const,
        ...(element.assetId ? { assetId: element.assetId } : {}),
      })),
      edges,
      layout: "layered",
      direction: "left_to_right",
      ...(cue ? { cue } : {}),
    });
  } else if (input.boardElements.length >= 2) {
    actions.push({
      action: "arrange_layout",
      id: `${prefix}-layout`,
      targets: input.boardElements.slice(0, 8).map((element) => element.id),
      preset: "grid",
      direction: "left_to_right",
      spacing: "airy",
      ...(cue ? { cue } : {}),
    });
  } else if (input.boardElements[0]) {
    actions.push({
      action: "emphasize",
      id: `${prefix}-emphasis`,
      target: input.boardElements[0].id,
      style: "spotlight",
      tone: "primary",
      ...(cue ? { cue } : {}),
    });
  }

  return visualPlanSchema.parse({
    version: 1,
    sceneId: `${prefix}-scene`,
    summary: "Deterministic visual fallback derived only from supplied lesson elements.",
    actions,
  });
}

async function defaultGenerate(request: {
  model: LanguageModel;
  input: VisualPlanningInput;
  system: string;
  abortSignal?: AbortSignal;
}): Promise<unknown> {
  // Force a real, stable action function call. A single architecture action
  // is substantially more reliable on local tool models than asking one call
  // to contain a deeply nested multi-action plan. The semantic plan wrapper
  // is deterministic; future asset catalogs can enable the sibling tools.
  const result = await generateText({
    model: request.model,
    tools: {
      draw_sequence: tool({
        description:
          "Draw the lesson's story as a sequence diagram: actors as lanes, each step a numbered arrow, the failure step red. Use for anything happening over time between actors.",
        inputSchema: sequenceStorySchema,
      }),
      draw_architecture: tool({
        description:
          "Select supplied board elements and relationships for one architecture, concept, or process diagram.",
        inputSchema: architectureSelectionSchema,
      }),
    },
    toolChoice: "required",
    system: request.system,
    prompt: JSON.stringify(request.input),
    providerOptions: { ollama: { reasoningEffort: "low" } },
    abortSignal: request.abortSignal,
    maxRetries: 0,
  });

  const sequenceCall = result.toolCalls.find((candidate) => candidate.toolName === "draw_sequence");
  if (sequenceCall) {
    const story = sequenceStorySchema.parse(sequenceCall.input);
    // Actors arrive as bare names or {name, color}; normalize, dedupe by name.
    const actorList: { name: string; color?: string }[] = [];
    for (const raw of story.actors) {
      const entry = typeof raw === "string" ? { name: raw.trim() } : { name: raw.name.trim(), color: raw.color };
      if (!entry.name || actorList.some((a) => a.name === entry.name)) continue;
      actorList.push(entry);
    }
    const actorNames = actorList.map((a) => a.name);
    const actors = actorList.map((a) => (a.color ? { name: a.name, color: a.color } : a.name));
    // Steps may only reference declared actors; a bad reference degrades to a
    // banner row instead of killing the diagram.
    const steps = story.steps.map((step) => ({
      ...(step.from && actorNames.includes(step.from) ? { from: step.from } : {}),
      ...(step.to && actorNames.includes(step.to) ? { to: step.to } : {}),
      ...(step.actor && actorNames.includes(step.actor) ? { actor: step.actor } : {}),
      label: clamp(step.label, 90),
      ...(step.color ? { color: step.color } : {}),
      ...(step.alert ? { alert: true } : {}),
    }));
    if (actors.length >= 2 && steps.length >= 2) {
      const cue = request.input.segments.some((segment) => segment.id === story.cueSegmentId)
        ? { segmentId: story.cueSegmentId!, timing: "during" as const }
        : request.input.segments[0]
          ? { segmentId: request.input.segments[0].id, timing: "during" as const }
          : undefined;
      const rawId = `story-${story.id.replace(/[^A-Za-z0-9._:-]+/g, "-") || "lesson"}`.slice(0, 80);
      const action: Extract<VisualAction, { action: "draw_diagram" }> = {
        action: "draw_diagram",
        id: /^[A-Za-z]/.test(rawId) ? rawId : `story-${safeIdPart(rawId)}`,
        title: clamp(request.input.objective, 120),
        spec: { type: "sequence", actors, steps },
        ...(cue ? { cue } : {}),
      };
      return visualPlanSchema.parse({
        version: 1,
        sceneId: `${action.id}-scene`,
        summary: action.title ?? `Visual story of ${request.input.topic}`.slice(0, 240),
        actions: [action],
      });
    }
  }

  const call = result.toolCalls.find((candidate) => candidate.toolName === "draw_architecture");
  if (!call) throw new Error("The visual model called neither draw_sequence (validly) nor draw_architecture.");
  const selection = architectureSelectionSchema.parse(call.input);
  const byId = new Map(request.input.boardElements.map((element) => [element.id, element]));
  const selectedIds = [...new Set(selection.nodeIds)].filter((id) => byId.has(id)).slice(0, 10);
  if (selectedIds.length < 2) throw new Error("The visual model selected fewer than two known elements.");
  const selected = new Set(selectedIds);
  const relationshipByPair = new Map(
    request.input.relationships.map((relationship) => [
      `${relationship.from}\u0000${relationship.to}`,
      relationship,
    ]),
  );
  const nodeIdByBoardId = new Map(
    selectedIds.map((id, index) => [id, `visual-node-${index + 1}`]),
  );
  const edges = selection.edges
    .filter((edge) => selected.has(edge.from) && selected.has(edge.to))
    .map((edge) => relationshipByPair.get(`${edge.from}\u0000${edge.to}`))
    .filter((relationship): relationship is NonNullable<typeof relationship> => Boolean(relationship))
    .map((relationship) => ({
      from: nodeIdByBoardId.get(relationship.from)!,
      to: nodeIdByBoardId.get(relationship.to)!,
      ...(relationship.label ? { label: clamp(relationship.label, 80) } : {}),
      relationship: relationship.relationship,
      direction: "forward" as const,
    }));
  const cue = request.input.segments.some((segment) => segment.id === selection.cueSegmentId)
    ? { segmentId: selection.cueSegmentId!, timing: "during" as const }
    : request.input.segments[0]
      ? { segmentId: request.input.segments[0].id, timing: "during" as const }
      : undefined;
  const actionId = `architecture-${selection.id.replace(/[^A-Za-z0-9._:-]+/g, "-") || "lesson"}`;
  const action: Extract<VisualAction, { action: "draw_architecture" }> = {
    action: "draw_architecture",
    id: /^[A-Za-z]/.test(actionId) ? actionId.slice(0, 80) : `architecture-${actionId}`.slice(0, 80),
    title: clamp(request.input.objective, 120),
    nodes: selectedIds.map((id) => ({
      id: nodeIdByBoardId.get(id)!,
      label: clamp(byId.get(id)!.label, 100),
      kind: byId.get(id)!.kind === "code" ? "process" : byId.get(id)!.kind === "image" ? "input" : "concept",
      ...(byId.get(id)!.assetId ? { assetId: byId.get(id)!.assetId } : {}),
    })),
    edges,
    layout: "layered",
    direction: selection.direction ?? "left_to_right",
    ...(cue ? { cue } : {}),
  };
  return visualPlanSchema.parse({
    version: 1,
    sceneId: `${action.id}-scene`,
    summary: action.title ?? `Visual map of ${request.input.topic}`.slice(0, 240),
    actions: [action],
  });
}

export async function planLessonVisuals(
  inputValue: VisualPlanningInput,
  options: VisualPlanningOptions = {},
): Promise<VisualPlanningResult> {
  const input = visualPlanningInputSchema.parse(inputValue);
  try {
    const model = options.model ?? slotModel("visual");
    const candidate = await (options.generate ?? defaultGenerate)({
      model,
      input,
      system: VISUAL_DIRECTOR_SYSTEM_PROMPT,
      abortSignal: options.abortSignal,
    });
    const validated = validateVisualPlan(candidate, input);
    if (validated.plan && validated.plan.actions.length > 0) {
      return { plan: validated.plan, source: "model", issues: validated.issues };
    }
    return {
      plan: fallbackVisualPlan(input),
      source: "fallback",
      issues: [
        ...validated.issues,
        {
          code: "empty_plan",
          message: "The visual model produced no executable actions; used the deterministic fallback.",
        },
      ],
    };
  } catch (error) {
    const issues: VisualPlanIssue[] = [
      {
        code: "generation_failed",
        message: error instanceof Error ? error.message : "Visual generation failed.",
      },
    ];
    try {
      return { plan: fallbackVisualPlan(input), source: "fallback", issues };
    } catch (fallbackError) {
      // The fallback exists so playback never stalls; if even it cannot build a
      // plan, hand back an empty one rather than propagating and 500-ing the
      // route. The lesson then plays with no director scene at all.
      return {
        plan: emptyVisualPlan(input),
        source: "fallback",
        issues: [
          ...issues,
          {
            code: "fallback_failed",
            message:
              fallbackError instanceof Error
                ? fallbackError.message
                : "The deterministic fallback could not build a plan.",
          },
        ],
      };
    }
  }
}
