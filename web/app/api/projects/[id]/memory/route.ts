import { NextResponse } from "next/server";
import { addProjectMemory, deleteProjectMemory, getProject, listProjectMemory, setProjectMemoryActive } from "@/lib/db";
import { z, validateBody } from "@/lib/server/validation";
import { withRouteHandler } from "@/lib/server/withRouteHandler";

// POST /api/projects/[id]/memory — add a memory entry. Body: { content }.
// `content` is required and trimmed; truncated to 500 chars, matching the prior
// inline guard (`typeof content !== "string" || !content.trim()` → 400).
const addMemoryBodySchema = z.object({
  content: z.string().trim().min(1),
});

// PATCH /api/projects/[id]/memory — toggle a memory entry's active flag.
// Body: { id, active }. Both fields required; the prior inline guard returned
// a 400 unless `id` was a string and `active` was a boolean. Note this route's
// PATCH/DELETE use the body/query param for the memory entry id, not the `[id]`
// route segment, so the handler ignores the resolved `params` here.
const updateMemoryBodySchema = z.object({
  id: z.string(),
  active: z.boolean(),
});

export const GET = withRouteHandler<{ id: string }>(async ({ params }) => {
  const { id } = params;
  if (!getProject(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ entries: listProjectMemory(id) });
});

export const POST = withRouteHandler<{ id: string }>(async ({ request, params }) => {
  const { id } = params;
  if (!getProject(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = await validateBody(request, addMemoryBodySchema);
  if (!parsed.ok) return parsed.response;
  const { content } = parsed.value;
  return NextResponse.json(addProjectMemory(id, content.slice(0, 500)), { status: 201 });
});

export const PATCH = withRouteHandler<{ id: string }>(async ({ request }) => {
  const parsed = await validateBody(request, updateMemoryBodySchema);
  if (!parsed.ok) return parsed.response;
  setProjectMemoryActive(parsed.value.id, parsed.value.active);
  return NextResponse.json({ ok: true });
});

export const DELETE = withRouteHandler<{ id: string }>(async ({ request }) => {
  const id = new URL(request.url).searchParams.get("entryId");
  if (!id) return NextResponse.json({ error: "Missing entryId" }, { status: 400 });
  deleteProjectMemory(id);
  return NextResponse.json({ ok: true });
});