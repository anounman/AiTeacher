import { NextResponse } from "next/server";
import { resolveSlotConfig } from "@/lib/llm/slots";

export async function POST() {
  const config = resolveSlotConfig("visual");
  if (config.provider !== "ollama") {
    return NextResponse.json({ warmed: false, reason: "visual slot is not Ollama" });
  }
  try {
    const url = new URL(config.baseURL);
    url.pathname = "/api/generate";
    url.search = "";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        prompt: "",
        stream: false,
        keep_alive: "15m",
        options: { num_predict: 1 },
      }),
      signal: AbortSignal.timeout(40_000),
    });
    return NextResponse.json({ warmed: response.ok });
  } catch {
    // Warming is opportunistic; lesson playback and the deterministic visual
    // fallback remain available regardless of this result.
    return NextResponse.json({ warmed: false });
  }
}
