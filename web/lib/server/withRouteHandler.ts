import { NextResponse } from "next/server";
import { generateRequestId, logger, withRequestId } from "@/lib/server/logger";

// The handler's happy-path context: the inbound request, the awaited params,
// and the requestId bound to the logger for the handler's duration.
export type RouteHandlerContext<TParams> = {
  request: Request;
  params: TParams;
  requestId: string;
};

export type RouteHandler<TParams> = (
  ctx: RouteHandlerContext<TParams>,
) => Promise<Response>;

// Higher-order wrapper for NON-streaming route handlers. Owns try/catch,
// request-id generation + logger binding, and a sanitized 500 so thrown errors
// never leak their message or stack to the client. Routes define only the
// happy path.
//
// `params` is a Promise in Next 16; the wrapper awaits it before invoking the
// handler so the handler receives a plain value.
export function withRouteHandler<TParams>(
  handler: RouteHandler<TParams>,
): (request: Request, ctx: { params: Promise<TParams> }) => Promise<Response> {
  return async (request, { params }) => {
    const requestId = generateRequestId();
    return withRequestId(requestId, async () => {
      let resolvedParams: TParams;
      try {
        resolvedParams = await params;
      } catch (error) {
        // Malformed path params (e.g. a failed dynamic-segment guard) are a
        // client error, but we still log + sanitize to avoid leaking details.
        logger.error("Route params resolution failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ error: "Internal error" }, { status: 500 });
      }

      try {
        return await handler({ request, params: resolvedParams, requestId });
      } catch (error) {
        logger.error("Unhandled route error", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        return NextResponse.json({ error: "Internal error" }, { status: 500 });
      }
    });
  };
}

// Convenience for routes that take no params (e.g. a GET with no dynamic
// segment). The handler still receives the full ctx for symmetry; params is
// `undefined`.
export function withRouteHandlerNoParams(
  handler: (ctx: { request: Request; requestId: string }) => Promise<Response>,
): (request: Request) => Promise<Response> {
  const wrapped = withRouteHandler<undefined>(async ({ request, requestId }) =>
    handler({ request, requestId }),
  );
  return async (request: Request) => wrapped(request, { params: Promise.resolve(undefined) });
}