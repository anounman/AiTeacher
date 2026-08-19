import { NextResponse } from "next/server";
import { z } from "zod";

export { z };

// Parses and validates a request body against a zod schema. Returns a
// discriminated union: on success the typed value; on failure a ready-to-send
// NextResponse (400 with a structured error). Used at route boundaries so the
// happy-path handler never re-implements JSON-parse or shape guards.
export type BodyResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: NextResponse };

export async function validateBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<BodyResult<T>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) };
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid request", issues: result.error.issues },
        { status: 400 },
      ),
    };
  }

  return { ok: true, value: result.data };
}