import { NextResponse } from "next/server";
import { searchGlobalHistory } from "@/lib/db";
import { withRouteHandlerNoParams } from "@/lib/server/withRouteHandler";

export const GET = withRouteHandlerNoParams(async ({ request }) => {
  const searchParams = new URL(request.url).searchParams;
  const query = searchParams.get("q")?.trim() ?? "";
  const activeProjectId = searchParams.get("projectId")?.trim() || null;
  if (query.length < 2) return NextResponse.json({ results: [] });
  return NextResponse.json({
    results: searchGlobalHistory(query.slice(0, 120), activeProjectId),
  });
});