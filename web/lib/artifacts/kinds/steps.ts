import { registerKind, hasOnlyKeys, isPlainObject, boundedString } from "../registry";

export type StepsData = { items: { title: string; detail: string; emphasis?: "default" | "key" }[] };

registerKind({
  kind: "steps",
  label: "Steps",
  promptSpec: `data:{items:[{title:string,detail:string,emphasis?:"default"|"key"}]}`,
  validate(data): { ok: true; data: StepsData } | { ok: false; reason: string } {
    const d = data as Record<string, unknown>;
    if (!hasOnlyKeys(d, ["items"]) || !Array.isArray(d.items) || d.items.length > 60) {
      return { ok: false, reason: "Steps items must contain at most 60 items" };
    }
    const items: StepsData["items"] = [];
    for (const item of d.items) {
      if (!isPlainObject(item) || !hasOnlyKeys(item, ["title", "detail", "emphasis"]) || !boundedString(item.title, 1000) || !boundedString(item.detail, 1000) || (item.emphasis !== undefined && item.emphasis !== "default" && item.emphasis !== "key")) {
        return { ok: false, reason: "Steps items contain invalid strings or values" };
      }
      items.push({ title: item.title, detail: item.detail, ...(item.emphasis !== undefined ? { emphasis: item.emphasis } : {}) });
    }
    return { ok: true, data: { items } };
  },
});
