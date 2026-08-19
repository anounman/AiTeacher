import { registerKind, hasOnlyKeys, boundedString, optionalString } from "../registry";

export type CalloutData = { label?: string; body: string; tone?: "idea" | "warning" | "formula" };

registerKind({
  kind: "callout",
  label: "Callout",
  promptSpec: `data:{label?:string,body:string,tone?:"idea"|"warning"|"formula"}`,
  validate(data): { ok: true; data: CalloutData } | { ok: false; reason: string } {
    const d = data as Record<string, unknown>;
    if (!hasOnlyKeys(d, ["label", "body", "tone"]) || !boundedString(d.body, 1000) || !optionalString(d.label, 1000) || (d.tone !== undefined && d.tone !== "idea" && d.tone !== "warning" && d.tone !== "formula")) {
      return { ok: false, reason: "Callout data contains invalid strings or values" };
    }
    return {
      ok: true,
      data: {
        body: d.body as string,
        ...(d.label !== undefined ? { label: d.label } : {}),
        ...(d.tone !== undefined ? { tone: d.tone } : {}),
      },
    };
  },
});
