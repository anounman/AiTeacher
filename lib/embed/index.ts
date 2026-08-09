import { embed, embedMany } from "ai";
import { getProvider, getModelConfig } from "@/lib/llm/provider";

// Resolve the live embedding model from the provider layer.
function embeddingModel() {
  const cfg = getModelConfig();
  const provider = getProvider(cfg.provider);
  if (!provider.embeddingModel) throw new Error(`Provider "${cfg.provider}" has no embedding model.`);
  return provider.embeddingModel({ model: cfg.embeddingModel, baseURL: cfg.baseURL, apiKey: cfg.apiKey });
}

export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: embeddingModel(), value: text });
  return embedding;
}

// Embed in batches of 64 to keep requests small.
export async function embedManyTexts(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const batch = texts.slice(i, i + 64);
    const { embeddings } = await embedMany({ model: embeddingModel(), values: batch });
    out.push(...embeddings);
  }
  return out;
}

export function encodeEmbedding(vec: number[]): Buffer {
  const f32 = Float32Array.from(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

export function decodeEmbedding(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}