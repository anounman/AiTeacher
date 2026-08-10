// Upload a material to the knowledge plane (ARCHITECTURE_V2 §2).
//
// The teacher service owns parsing, chunking, embedding and the index; the
// local materials row stays as the UI's record of what the learner added and
// what state it is in. `external_id` is the material id, which is how a
// retrieved chunk finds its way back to concepts and mastery here.

const TEACHER_URL = process.env.TEACHER_URL ?? "http://127.0.0.1:8900";

export interface TeacherIngestResult {
  id: number;
  title: string;
  status: string;
  error: string | null;
  chunks: number;
  chars: number;
  metadata: Record<string, unknown>;
}

export async function ingestToTeacher(opts: {
  projectId: string;
  materialId: string;
  filename: string;
  bytes: Uint8Array | ArrayBuffer;
  sourceUri?: string;
}): Promise<TeacherIngestResult> {
  const form = new FormData();
  const bytes = opts.bytes instanceof ArrayBuffer ? new Uint8Array(opts.bytes) : opts.bytes;
  form.append("file", new Blob([bytes as BlobPart]), opts.filename);
  form.append("workspace_id", opts.projectId);
  form.append("external_id", opts.materialId);
  if (opts.sourceUri) form.append("source_uri", opts.sourceUri);

  // Docling runs a layout model on every page; a long PDF legitimately takes
  // minutes. This is the upload path, not a lesson turn, so it may wait.
  const res = await fetch(`${TEACHER_URL}/knowledge/documents`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(15 * 60_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`teacher ingest failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as TeacherIngestResult;
}
