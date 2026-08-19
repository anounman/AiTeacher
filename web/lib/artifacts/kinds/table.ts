import { registerKind, hasOnlyKeys, stringArray, cellValue } from "../registry";

export type TableData = { columns: string[]; rows: (string | number)[][] };

registerKind({
  kind: "table",
  label: "Data table",
  promptSpec: `data:{columns:string[],rows:(string|number)[][]}`,
  validate(data): { ok: true; data: TableData } | { ok: false; reason: string } {
    const d = data as Record<string, unknown>;
    if (!hasOnlyKeys(d, ["columns", "rows"]) || !stringArray(d.columns, 12, 1000)) {
      return { ok: false, reason: "Table columns must contain at most 12 strings" };
    }
    if (!Array.isArray(d.rows) || d.rows.length > 60) return { ok: false, reason: "Table rows must contain at most 60 rows" };
    for (const row of d.rows) {
      if (!Array.isArray(row) || row.length !== d.columns.length || row.some((cell) => !cellValue(cell))) {
        return { ok: false, reason: "Table rows must match the columns and contain bounded strings or numbers" };
      }
    }
    return { ok: true, data: { columns: d.columns as string[], rows: d.rows as (string | number)[][] } };
  },
});
