import { NextResponse } from "next/server";
import { getAllSettings, setSetting, getTotalTokens } from "@/lib/db";
import { getModelConfig } from "@/lib/llm/provider";
import {
  MODEL_SLOTS,
  getSlotDefinition,
  isModelSlot,
  resolveSlotConfig,
  slotSettingKey,
} from "@/lib/llm/slots";
import { getLearnerProfile, setLearnerProfile } from "@/lib/learner/profile";
import { getMcpServers, setMcpServers, type McpServerConfig } from "@/lib/mcp/client";

// What each capability slot currently resolves to, and why — so the Settings
// UI can show the effective model plus the checked-in default it overrides.
function slotState() {
  return MODEL_SLOTS.map((slot) => ({
    slot,
    model: resolveSlotConfig(slot).model,
    defaultModel: getSlotDefinition(slot).model,
    saved: getAllSettings()[slotSettingKey(slot)] ?? "",
    pinnedByEnv: Boolean(process.env[`OLLAMA_${slot.toUpperCase()}_MODEL`]?.trim()),
  }));
}

// GET /api/settings — live model/provider config (merged with .env defaults),
// plus the global token count (sum of every message's estimate).
export async function GET() {
  return NextResponse.json({
    ...getModelConfig(),
    totalTokens: getTotalTokens(),
    raw: getAllSettings(),
    slots: slotState(),
    learnerProfile: getLearnerProfile(),
    mcpServers: getMcpServers(),
  });
}

// PATCH /api/settings — persist provider / model / baseUrl / apiKey / theme.
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.provider === "string") setSetting("provider", body.provider);
  if (typeof body.model === "string") setSetting("model", body.model);
  if (typeof body.baseUrl === "string") setSetting("baseUrl", body.baseUrl);
  if (typeof body.apiKey === "string") setSetting("apiKey", body.apiKey);
  if (typeof body.tavilyApiKey === "string") setSetting("tavilyApiKey", body.tavilyApiKey);
  if (typeof body.openaiApiKey === "string") setSetting("openaiApiKey", body.openaiApiKey);
  if (typeof body.theme === "string") setSetting("theme", body.theme);
  if (typeof body.embeddingModel === "string") setSetting("embeddingModel", body.embeddingModel);
  // Per-slot model picks: {"slots": {"reason": "deepseek-v4-pro:cloud"}}.
  // An empty string clears the override and falls back to config/models.json.
  if (body.slots && typeof body.slots === "object") {
    for (const [slot, model] of Object.entries(body.slots as Record<string, unknown>)) {
      if (isModelSlot(slot) && typeof model === "string") {
        setSetting(slotSettingKey(slot), model.trim());
      }
    }
  }
  // Learner profile (Hermes-style self-improvement memory): editable so the
  // student can correct or erase what the tutor has inferred about them.
  if (typeof body.learnerProfile === "string") setLearnerProfile(body.learnerProfile);
  // MCP connections: full-array replace. Validated field-by-field — this is
  // config that can spawn local processes, so unknown shapes are dropped.
  if (Array.isArray(body.mcpServers)) {
    const clean: McpServerConfig[] = (body.mcpServers as unknown[])
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s, i) => ({
        id: typeof s.id === "string" && s.id ? s.id.slice(0, 40) : `mcp-${i}`,
        name: String(s.name ?? "").replace(/[^\w-]/g, "").slice(0, 24) || `server${i}`,
        transport: s.transport === "http" ? "http" as const : "stdio" as const,
        command: typeof s.command === "string" ? s.command.slice(0, 300) : undefined,
        args: Array.isArray(s.args) ? s.args.map(String).slice(0, 16) : undefined,
        url: typeof s.url === "string" ? s.url.slice(0, 300) : undefined,
        enabled: s.enabled === true,
      }));
    setMcpServers(clean);
  }
  return NextResponse.json({
    ...getModelConfig(),
    totalTokens: getTotalTokens(),
    raw: getAllSettings(),
    slots: slotState(),
    learnerProfile: getLearnerProfile(),
    mcpServers: getMcpServers(),
  });
}