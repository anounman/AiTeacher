import { NextResponse } from "next/server";
import { getModelConfig } from "@/lib/llm/provider";
import { isVisionModel } from "@/lib/llm/vision";

// GET /api/models — lists models available on the configured backend, each
// tagged with whether the vision heuristic considers it vision-capable. Used
// by the header model switcher. Non-fatal: returns an empty list (200) if the
// backend is unreachable, so the switcher degrades to the current model only.
//
// `?all=1` keeps embedding models in the list — Settings needs them to pick the
// `embed` slot, whereas the chat switcher must not offer one.
export async function GET(req: Request) {
  const cfg = getModelConfig();
  const all = new URL(req.url).searchParams.get("all") === "1";
  try {
    const res = await fetch(`${cfg.baseURL}/models`, {
      signal: AbortSignal.timeout(3000),
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
    });
    if (!res.ok) return NextResponse.json({ models: [] });
    const data = (await res.json()) as { data?: { id: string }[] };
    const models = (data.data ?? [])
      // Embedding models can't chat — picking one silently breaks every turn.
      .filter((m) => all || !/embed/i.test(m.id))
      .map((m) => ({
        id: m.id,
        vision: isVisionModel(m.id),
      }));
    return NextResponse.json({ models });
  } catch {
    return NextResponse.json({ models: [] });
  }
}