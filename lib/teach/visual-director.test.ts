import { test } from "node:test";
import assert from "node:assert/strict";
import type { LanguageModel } from "ai";
import { getSlotDefinition } from "@/lib/llm/slots";
import {
  VISUAL_ACTION_NAMES,
  visualActionFromFunctionCall,
  visualPlanSchema,
  type VisualPlanningInput,
} from "./visual-schema";
import {
  fallbackVisualPlan,
  planLessonVisuals,
  validateVisualPlan,
} from "./visual-director";

const baseInput: VisualPlanningInput = {
  lessonId: "lesson-1",
  topic: "Request lifecycle",
  objective: "Show how a request moves through the system",
  segments: [
    { id: "segment-1", text: "A request first enters the API.", boardElementIds: ["board-api"] },
  ],
  boardElements: [
    { id: "board-api", label: "API", kind: "concept" },
    { id: "board-db", label: "Database", kind: "concept", assetId: "stores/database" },
  ],
  relationships: [
    { from: "board-api", to: "board-db", label: "query", relationship: "flow" },
  ],
  assetCatalog: [
    { id: "characters/teacher", label: "Teacher", kind: "character", tags: ["guide"] },
  ],
};

test("visual action names are a stable function-calling contract", () => {
  assert.deepEqual(VISUAL_ACTION_NAMES, [
    "place_asset",
    "write_label",
    "draw_arrow",
    "draw_architecture",
    "arrange_layout",
    "group_elements",
    "emphasize",
  ]);

  const action = visualActionFromFunctionCall("draw_arrow", {
    id: "arrow-1",
    from: "source-1",
    to: "target-1",
  });
  assert.equal(action?.action, "draw_arrow");
  if (action?.action === "draw_arrow") {
    assert.equal(action.path, "curved");
    assert.equal(action.direction, "forward");
  }
  assert.equal(visualActionFromFunctionCall("unknown_tool", {}), null);
});

test("visual slot is its own tool-capable model with room for a lesson", () => {
  const definition = getSlotDefinition("visual");
  // The pick is config, not contract — assert the invariants the director
  // depends on rather than a specific model name.
  assert.ok(definition.model.length > 0);
  assert.notEqual(definition.model, getSlotDefinition("reason").model);
  assert.ok("ctx" in definition && definition.ctx >= 8192);
});

test("validator preserves future asset keys and removes bad references independently", () => {
  const candidate = {
    version: 1,
    sceneId: "request-scene",
    actions: [
      {
        action: "place_asset",
        id: "future-icon",
        assetId: "future/arrows/curved-blue",
        label: "Flow marker",
        cue: { segmentId: "missing-segment" },
      },
      {
        action: "draw_arrow",
        id: "bad-arrow",
        from: "missing-source",
        to: "board-api",
      },
      {
        action: "write_label",
        id: "cache-label",
        text: "Cache",
      },
      {
        action: "draw_arrow",
        id: "good-arrow",
        from: "board-api",
        to: "cache-label",
        relationship: "flow",
      },
      {
        action: "draw_architecture",
        id: "system-map",
        nodes: [
          { id: "node-api", label: "API" },
          { id: "node-db", label: "Database" },
        ],
        edges: [
          { from: "node-api", to: "node-db" },
          { from: "node-api", to: "missing-node" },
        ],
      },
    ],
  };

  const result = validateVisualPlan(candidate, baseInput);
  assert.ok(result.plan);
  assert.deepEqual(
    result.plan?.actions.map((action) => action.id),
    ["future-icon", "cache-label", "good-arrow", "system-map"],
  );
  const future = result.plan?.actions[0];
  assert.equal(future?.action, "place_asset");
  if (future?.action === "place_asset") {
    assert.equal(future.assetId, "future/arrows/curved-blue");
    assert.equal(future.cue, undefined);
  }
  const architecture = result.plan?.actions.at(-1);
  assert.equal(architecture?.action, "draw_architecture");
  if (architecture?.action === "draw_architecture") {
    assert.equal(architecture.edges.length, 1);
  }
  assert.ok(result.issues.some((issue) => issue.code === "unknown_asset"));
  assert.ok(result.issues.some((issue) => issue.code === "unknown_segment"));
  assert.ok(result.issues.some((issue) => issue.code === "unknown_reference"));
  assert.ok(result.issues.some((issue) => issue.code === "invalid_architecture_edge"));
});

test("fallback architecture contains only supplied labels and relationships", () => {
  const fallback = fallbackVisualPlan(baseInput);
  assert.doesNotThrow(() => visualPlanSchema.parse(fallback));
  const architecture = fallback.actions.find(
    (action) => action.action === "draw_architecture",
  );
  assert.ok(architecture && architecture.action === "draw_architecture");
  if (architecture?.action === "draw_architecture") {
    assert.deepEqual(
      architecture.nodes.map((node) => node.label),
      ["API", "Database"],
    );
    assert.equal(architecture.edges[0]?.label, "query");
    assert.equal(architecture.nodes[1]?.assetId, "stores/database");
  }
});

test("planner degrades to the deterministic plan when structured generation fails", async () => {
  const result = await planLessonVisuals(baseInput, {
    model: {} as LanguageModel,
    generate: async () => {
      throw new Error("Ollama unavailable");
    },
  });
  assert.equal(result.source, "fallback");
  assert.ok(result.plan.actions.length > 0);
  assert.equal(result.issues[0]?.code, "generation_failed");
});
