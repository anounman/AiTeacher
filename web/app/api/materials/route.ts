import { NextResponse } from "next/server";
import { createMaterial, getMaterial, getProject, updateMaterialStatus } from "@/lib/db";
import { getModelConfig, getProvider } from "@/lib/llm/provider";
import { extractPdf, extractUrl, ingestFromText } from "@/lib/ingest";
import { ingestToTeacher } from "@/lib/ingest/teacher";

// POST /api/materials — multipart/form-data: { projectId, title?, file? | url? }
// or JSON: { projectId, title?, url }. Creates a material (status=processing),
// extracts text, ingests (chunks+embeds) synchronously, and returns the material
// row (status will be `ready` or `error` by the time we respond).
export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  let projectId: string | undefined;
  let title: string | undefined;
  let url: string | undefined;
  let uploadFile: File | undefined;
  let fileName: string | undefined;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    projectId = String(form.get("projectId") || "");
    title = (form.get("title") as string) || undefined;
    url = (form.get("url") as string) || undefined;
    const file = form.get("file");
    if (file && file instanceof File) {
      uploadFile = file;
      fileName = file.name;
    }
  } else {
    const body = await req.json().catch(() => ({}));
    projectId = body.projectId;
    title = body.title;
    url = body.url;
  }

  if (!projectId || !getProject(projectId)) {
    return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
  }
  if (!uploadFile && !url) {
    return NextResponse.json({ error: "Provide a supported file or a URL" }, { status: 400 });
  }

  const isPdf = !!uploadFile && (uploadFile.type === "application/pdf" || /\.pdf$/i.test(uploadFile.name));
  const textFilePattern = /\.(txt|md|markdown|csv|tsv|json|yaml|yml|xml|html?|css|js|jsx|ts|tsx|py|java|c|cc|cpp|h|hpp|go|rs|sql)$/i;
  if (uploadFile && !isPdf && !textFilePattern.test(uploadFile.name) && !uploadFile.type.startsWith("text/")) {
    return NextResponse.json(
      { error: "Unsupported file. Upload PDF, text, Markdown, CSV, JSON, HTML, or a source-code file." },
      { status: 415 },
    );
  }
  if (uploadFile && uploadFile.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "Files are limited to 25 MB." }, { status: 413 });
  }

  const sourceType = uploadFile ? (isPdf ? "pdf" : "file") : "url";
  const baseName = fileName ? fileName.replace(/\.[^.]+$/i, "") : undefined;
  const sourceRef = uploadFile ? fileName || title || "uploaded file" : url!;
  const material = createMaterial({
    projectId,
    title: title?.trim() || baseName || sourceRef,
    sourceType,
    sourceRef,
  });

  // Preflight the embedding model before extraction+ingestion. If the
  // embedding model (default nomic-embed-text) isn't pulled, ingestion would
  // otherwise throw a messy Ollama API error; this surfaces the clean
  // "Pull it with `ollama pull nomic-embed-text`" message instead.
  try {
    const cfg = getModelConfig();
    const provider = getProvider(cfg.provider);
    if (provider.validateEmbedding) {
      await provider.validateEmbedding({ model: cfg.embeddingModel, baseURL: cfg.baseURL, apiKey: cfg.apiKey });
    }
  } catch (err) {
    updateMaterialStatus(material.id, "error", {
      error: err instanceof Error ? err.message : "Embedding model unavailable",
    });
    return NextResponse.json(getMaterial(material.id), { status: 502 });
  }

  // Ingest through the knowledge plane, which owns parsing (docling for
  // page-accurate PDFs, markitdown for the rest), chunking and the index.
  // The local SQLite path stays as the fallback for when that service is
  // down — a learner adding a source should not have to know it exists.
  try {
    if (uploadFile) {
      const bytes = new Uint8Array(await uploadFile.arrayBuffer());
      try {
        const result = await ingestToTeacher({
          projectId,
          materialId: material.id,
          filename: fileName || sourceRef,
          bytes,
          sourceUri: sourceRef,
        });
        if (result.status === "error") throw new Error(result.error ?? "ingest failed");
        // The converted text now lives in the knowledge plane; keeping a
        // second copy here would be the thing that goes stale.
        updateMaterialStatus(material.id, "ready", { charCount: result.chars, text: "" });
        return NextResponse.json(getMaterial(material.id), { status: 201 });
      } catch (err) {
        console.warn("[materials] teacher ingest failed, using local index:", err);
      }
    }

    if (uploadFile && isPdf) {
      const extracted = await extractPdf(new Uint8Array(await uploadFile.arrayBuffer()));
      await ingestFromText(material.id, extracted.text, { pages: extracted.pages });
    } else {
      const text = uploadFile ? await uploadFile.text() : (await extractUrl(url!)).text;
      await ingestFromText(material.id, text);
    }
  } catch (err) {
    updateMaterialStatus(material.id, "error", {
      error: err instanceof Error ? err.message : "Extraction failed",
    });
  }

  // Re-read so the response reflects the final status/text/error.
  return NextResponse.json(getMaterial(material.id), { status: 201 });
}
