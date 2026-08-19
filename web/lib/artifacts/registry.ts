// Artifact kind registry — the general manufacturing process.
//
// Each native artifact kind (diagram, table, chart, …) is a self-contained
// module in `./kinds/*` that calls `registerKind` at import time. The registry
// replaces the closed `switch(kind)` validator + inline dispatch with a single
// lookup, so adding a kind is one file + one registration line (see spec
// 2026-08-19-artifact-manufacturing-engine-design.md).
//
// `classifyArtifact` owns the shared envelope validation (schema, version,
// kind, top-level keys, title/summary bounds) and dispatches the kind-specific
// `data` validation to the registered kind. Before rejecting an unknown kind,
// it runs the alias map (`resolveKind`) so an ad-hoc model-emitted kind like
// `erm`/`flowchart`/`graph` normalizes to a native kind — the direct fix for
// the "ERM → artifact not supported" dead end.

export const NATIVE_ARTIFACT_SCHEMA = "studygpt.artifact" as const;
export const NATIVE_ARTIFACT_VERSION = 1 as const;

export type ArtifactClassification =
  | { type: "native"; artifact: { schema: typeof NATIVE_ARTIFACT_SCHEMA; version: typeof NATIVE_ARTIFACT_VERSION; kind: string; title?: string; summary?: string; data: unknown } }
  | { type: "legacy-html"; html: string }
  | { type: "invalid"; source: string; reason: string };

export type KindValidation<T> = { ok: true; data: T } | { ok: false; reason: string };
export type KindValidator<T> = (data: unknown) => KindValidation<T>;

export interface KindDefinition<T = unknown> {
  kind: string;
  label: string;
  // Short data-shape hint injected into the generation prompt so the model
  // emits the right shape, and into the transform prompt's kind list. Kept on
  // the kind module so the prompt can never drift from the validator.
  promptSpec: string;
  // Model-emitted kind strings that normalize to this kind before validation.
  // Lets an ad-hoc `erm`/`flowchart`/`graph` route to a native kind instead of
  // a dead-end "unsupported kind". Recovery only: if the native kind's
  // validator rejects the payload, it still falls to the invalid fallback
  // (or to the next candidate — see `resolveKindCandidates`).
  aliases?: string[];
  // Optional kind-specific pre-validation transform on the whole envelope
  // (e.g. chart normalizes `xAxis.values`→`labels`, `series.name`→`label`,
  // hoists `data.title`→top-level `title`). Runs AFTER the basic envelope
  // shape check (schema/version/kind) and BEFORE the top-level keys / title /
  // data checks, so normalized fields are validated.
  normalize?: (value: Record<string, unknown>) => Record<string, unknown>;
  validate: KindValidator<T>;
}

const registry = new Map<string, KindDefinition>();
// An ad-hoc kind may map to an ORDERED list of candidate native kinds. The
// first candidate whose validator accepts the payload wins; if none accept,
// the artifact falls to the invalid fallback. This lets `erm` try `figure`
// (notation-faithful DSL) first and fall back to `diagram` (Mermaid) when the
// model emitted Mermaid content instead of the figure DSL — robust to either
// steering the notation block did.
const aliasToCandidates = new Map<string, string[]>();

export function registerKind<T>(def: KindDefinition<T>): void {
  // Idempotent under HMR: Next's Turbopack dev re-evaluates side-effect
  // modules (kinds/index.ts → kinds/*.ts) against the already-populated
  // registry. A hard throw here crashes the client module graph and React
  // hydration fails → nothing on the page is clickable. So on a repeat call
  // for the SAME kind, silently overwrite (HMR gives a fresh, possibly updated
  // def) instead of throwing. Throw only for a genuine collision: two
  // DIFFERENT kind names aliasing to conflicting candidate orders — which the
  // structure of this codebase can't produce, but is worth guarding.
  registry.set(def.kind, def as unknown as KindDefinition);
  for (const alias of def.aliases ?? []) {
    const existing = aliasToCandidates.get(alias);
    if (existing) {
      // append if this kind isn't already a candidate (HMR may re-run a kind
      // module; don't duplicate its entry). Registration order is preserved:
      // `figure` (imported first) stays ahead of `diagram` (imported second)
      // in a shared alias's candidate list.
      if (!existing.includes(def.kind)) existing.push(def.kind);
    } else {
      aliasToCandidates.set(alias, [def.kind]);
    }
  }
}

export function getKind(kind: string): KindDefinition | undefined {
  return registry.get(kind);
}

// Ordered candidate native kinds for an ad-hoc kind: the kind itself (if
// registered) first, then any alias targets in registration order. The caller
// tries each until one validates.
export function resolveKindCandidates(kind: string): string[] {
  const candidates: string[] = [];
  if (registry.has(kind)) candidates.push(kind);
  for (const target of aliasToCandidates.get(kind) ?? []) {
    if (!candidates.includes(target)) candidates.push(target);
  }
  return candidates;
}

export function resolveKind(kind: string): string {
  return resolveKindCandidates(kind)[0] ?? kind;
}

export function registeredKinds(): KindDefinition[] {
  return [...registry.values()];
}

// The "pick one supported kind" list injected into the generation + transform
// prompts. Derived from the registry so it can never drift from the
// validators. Format: `diagram (data:{mermaid:string}), table (...), ...`.
export function artifactKindListPrompt(): string {
  return registeredKinds()
    .map((def) => `${def.kind} (${def.promptSpec})`)
    .join(", ");
}

export function artifactKindLabel(kind: string): string {
  const def = getKind(resolveKind(kind));
  return def?.label ?? "Artifact";
}

// Keys a native envelope may never carry, anywhere — the data-only contract.
// Belt-and-suspenders against the model slipping HTML/CSS/JS/SVG/URLs into a
// kind's `data` even when the kind's allowed-keys list doesn't name them.
const FORBIDDEN_KEYS = new Set(["html", "css", "script", "svg", "url", "href", "src"]);

function invalid(source: string, reason: string): ArtifactClassification {
  return { type: "invalid", source, reason };
}

export function classifyArtifact(source: string): ArtifactClassification {
  const trimmed = source.trim();

  if (/^<!doctype\b/i.test(trimmed) || /^<html(?:\s|>)/i.test(trimmed) || /^<[a-z][^>]*>/i.test(trimmed)) {
    return { type: "legacy-html", html: trimmed };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return invalid(trimmed, "Source is not valid JSON");
  }

  if (!isPlainObject(parsed)) return invalid(trimmed, "Artifact must be a plain JSON object");
  if (parsed.schema !== NATIVE_ARTIFACT_SCHEMA) return invalid(trimmed, "Artifact schema is missing or unsupported");
  if (parsed.version !== NATIVE_ARTIFACT_VERSION) return invalid(trimmed, "Artifact version is unsupported");
  if (typeof parsed.kind !== "string") return invalid(trimmed, "Artifact kind is required");

  // Try each candidate native kind in order (the kind itself, then any alias
  // targets). The first whose normalize + key check + data validator all pass
  // wins. If none accept the payload, return the last candidate's reason — so
  // an `erm` carrying Mermaid content tries `figure` (rejects), then `diagram`
  // (accepts); an `erm` carrying figure DSL tries `figure` (accepts).
  const candidates = resolveKindCandidates(parsed.kind);
  if (candidates.length === 0) return invalid(trimmed, "Artifact kind is unsupported");

  let lastReason = "Artifact kind is unsupported";
  for (const canonical of candidates) {
    const def = getKind(canonical);
    if (!def) continue;

    // Kind-specific normalization (chart shape compat) before shared key checks.
    const value = def.normalize ? def.normalize(parsed) : parsed;

    if (!hasOnlyKeys(value, ["schema", "version", "kind", "title", "summary", "data"])) {
      lastReason = "Artifact contains unsupported keys";
      continue;
    }
    if (!optionalString(value.title, 160)) { lastReason = "Title must be at most 160 characters"; continue; }
    if (!optionalString(value.summary, 320)) { lastReason = "Summary must be at most 320 characters"; continue; }
    if (!isPlainObject(value.data)) { lastReason = "Artifact data must be an object"; continue; }

    const result = def.validate(value.data);
    if (!result.ok) { lastReason = result.reason; continue; }

    return {
      type: "native",
      artifact: {
        schema: NATIVE_ARTIFACT_SCHEMA,
        version: NATIVE_ARTIFACT_VERSION,
        kind: canonical,
        ...(value.title !== undefined ? { title: value.title } : {}),
        ...(value.summary !== undefined ? { summary: value.summary } : {}),
        data: result.data,
      },
    };
  }
  return invalid(trimmed, lastReason);
}

// --- Shared validation helpers used by kind validators ---------------------

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key) && !FORBIDDEN_KEYS.has(key));
}

export function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

export function optionalString(value: unknown, maxLength: number): value is string | undefined {
  return value === undefined || boundedString(value, maxLength);
}

export function stringArray(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return Array.isArray(value) && value.length <= maxItems && value.every((item) => boundedString(item, maxLength));
}

export function cellValue(value: unknown): value is string | number {
  return (typeof value === "string" && value.length <= 1000) || (typeof value === "number" && Number.isFinite(value));
}
