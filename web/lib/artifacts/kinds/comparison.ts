import { registerKind, hasOnlyKeys, isPlainObject, boundedString, optionalString } from "../registry";

export type ComparisonData = { items: { label: string; value: string; detail?: string }[] };

registerKind({
  kind: "comparison",
  label: "Comparison",
  promptSpec: `data:{items:[{label:string,value:string,detail?:string}]}`,
  validate(data): { ok: true; data: ComparisonData } | { ok: false; reason: string } {
    const d = data as Record<string, unknown>;
    if (!hasOnlyKeys(d, ["items"]) || !Array.isArray(d.items) || d.items.length > 60) {
      return { ok: false, reason: "Comparison items must contain at most 60 items" };
    }
    const items: ComparisonData["items"] = [];
    for (const item of d.items) {
      if (!isPlainObject(item) || !hasOnlyKeys(item, ["label", "value", "detail"]) || !boundedString(item.label, 1000) || !boundedString(item.value, 1000) || !optionalString(item.detail, 1000)) {
        return { ok: false, reason: "Comparison items contain invalid strings or keys" };
      }
      items.push({ label: item.label, value: item.value, ...(item.detail !== undefined ? { detail: item.detail } : {}) });
    }
    return { ok: true, data: { items } };
  },
});
