import { NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import { getModelConfig, getProvider } from "@/lib/llm/provider";
import { extractConceptsForProject } from "@/lib/concepts/extract";

// POST /api/concepts/extract — build (or refresh) the concept graph for a
// project. Preflights the chat model so a down backend returns a clean 502
// BEFORE any extraction runs (no partial DB state). Extraction is idempotent:
// materials whose text is unchanged since last extraction are skipped.
export async function POST(req: Request) {
  const { projectId } = await req.json().catch(() => ({}));
  if (typeof projectId !== "string" || !projectId.trim()) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  if (!getProject(projectId)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  try {
    const cfg = getModelConfig();
    const provider = getProvider(cfg.provider);
    if (provider.validate) {
      await provider.validate({ model: cfg.model, baseURL: cfg.baseURL, apiKey: cfg.apiKey });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Chat model unavailable" },
      { status: 502 },
    );
  }
  return NextResponse.json(await extractConceptsForProject(projectId));
}