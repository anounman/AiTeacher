import type { EmbeddingModel, LanguageModel } from "ai";
import models from "@/config/models.json";
import { getAllSettings } from "@/lib/db";
import { getModelConfig, getProvider } from "./provider";

// Stable capability names used by application code. Model names stay in
// config/models.json so each capability can be benchmarked or replaced
// without changing its consumers.
export const LANGUAGE_MODEL_SLOTS = ["parse", "dispatch", "reason", "visual", "read"] as const;
export const MODEL_SLOTS = [...LANGUAGE_MODEL_SLOTS, "embed"] as const;

export type LanguageModelSlot = (typeof LANGUAGE_MODEL_SLOTS)[number];
export type ModelSlot = (typeof MODEL_SLOTS)[number];

type LanguageSlotDefinition = {
  model: string;
  ctx: number;
  think_budget_tokens?: number;
};

type EmbeddingSlotDefinition = {
  model: string;
  dim: number;
};

export type SlotDefinition = LanguageSlotDefinition | EmbeddingSlotDefinition;

export interface SlotOverride {
  model?: string;
  provider?: string;
  baseURL?: string;
  apiKey?: string;
}

export interface ResolvedSlotConfig extends SlotOverride {
  slot: ModelSlot;
  model: string;
  provider: string;
  baseURL: string;
  apiKey: string;
  contextWindow?: number;
  embeddingDimensions?: number;
  thinkBudgetTokens?: number;
}

const definitions = models.slots as Record<ModelSlot, SlotDefinition>;

function slotEnvName(slot: ModelSlot): string {
  return `OLLAMA_${slot.toUpperCase()}_MODEL`;
}

/** Settings-store key holding a user-chosen model for one slot. */
export function slotSettingKey(slot: ModelSlot): string {
  return `slot.${slot}.model`;
}

export function isModelSlot(value: string): value is ModelSlot {
  return (MODEL_SLOTS as readonly string[]).includes(value);
}

export function getSlotDefinition(slot: ModelSlot): SlotDefinition {
  return definitions[slot];
}

// Resolution order is explicit call-site override -> per-slot environment
// override -> Settings choice -> checked-in slot configuration. Env stays above
// Settings so a deployment can pin a slot that the UI cannot then undo. The
// existing Settings provider, endpoint and key remain authoritative, while its
// legacy single `model` setting intentionally does not collapse all
// capabilities back to one model.
export function resolveSlotConfig(
  slot: ModelSlot,
  override: SlotOverride = {},
): ResolvedSlotConfig {
  const live = getModelConfig();
  const definition = getSlotDefinition(slot);
  const envModel = process.env[slotEnvName(slot)]?.trim();
  const savedModel = getAllSettings()[slotSettingKey(slot)]?.trim();

  return {
    slot,
    provider: override.provider ?? live.provider,
    model: override.model?.trim() || envModel || savedModel || definition.model,
    baseURL: override.baseURL ?? live.baseURL,
    apiKey: override.apiKey ?? live.apiKey,
    ...(slot === "embed"
      ? { embeddingDimensions: (definition as EmbeddingSlotDefinition).dim }
      : {
          contextWindow: (definition as LanguageSlotDefinition).ctx,
          ...((definition as LanguageSlotDefinition).think_budget_tokens
            ? {
                thinkBudgetTokens: (definition as LanguageSlotDefinition)
                  .think_budget_tokens,
              }
            : {}),
        }),
  };
}

export function slotModel(
  slot: LanguageModelSlot,
  override: SlotOverride = {},
): LanguageModel {
  const config = resolveSlotConfig(slot, override);
  return getProvider(config.provider).languageModel(config);
}

export function slotEmbeddingModel(override: SlotOverride = {}): EmbeddingModel {
  const config = resolveSlotConfig("embed", override);
  const provider = getProvider(config.provider);
  if (!provider.embeddingModel) {
    throw new Error(`Provider "${config.provider}" does not support embeddings.`);
  }
  return provider.embeddingModel(config);
}

// Optional preflight for routes/jobs that want a clean human-readable failure
// before generation. Model construction itself remains synchronous.
export async function validateSlot(
  slot: ModelSlot,
  override: SlotOverride = {},
): Promise<void> {
  const config = resolveSlotConfig(slot, override);
  const provider = getProvider(config.provider);
  if (slot === "embed") {
    await provider.validateEmbedding?.(config);
  } else {
    await provider.validate?.(config);
  }
}
