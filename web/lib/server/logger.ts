import { randomUUID } from "node:crypto";

// Module-level current request id. Bound for the duration of a handler by
// `withRouteHandler` (via `withRequestId`) so any log line inside the handler
// carries the same id without threading it through every call.
let currentRequestId: string | undefined;

export function generateRequestId(): string {
  return randomUUID();
}

type Level = "info" | "warn" | "error";

function write(level: Level, msg: string, ctx?: Record<string, unknown>, requestIdOverride?: string) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...ctx,
    requestId: requestIdOverride ?? currentRequestId,
  });
  // Server-side only: structured logs go to stderr, never echoed to the client.
  process.stderr.write(line + "\n");
}

export const logger = {
  info: (msg: string, ctx?: Record<string, unknown>) => write("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => write("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => write("error", msg, ctx),
};

// Binds a request id to the module context for the duration of `fn`, restoring
// the previous binding on return (so nested handlers don't leak their id).
export async function withRequestId<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = currentRequestId;
  currentRequestId = id;
  try {
    return await fn();
  } finally {
    currentRequestId = previous;
  }
}

// Test hook: reset the module-level id between cases so assertions don't bleed.
export function _resetRequestIdForTest(): void {
  currentRequestId = undefined;
}