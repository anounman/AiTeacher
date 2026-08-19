import { registerKind, hasOnlyKeys, isPlainObject, boundedString, stringArray } from "../registry";

export type ChartData = {
  chartType: "bar" | "line";
  labels: string[];
  series: { label: string; values: number[] }[];
};

// Normalizes the loose chart shapes the model emits into the canonical form
// before validation: `data.xAxis.values`→`labels`, `series.name`→`label`,
// and `data.title` hoisted to the top-level envelope `title` (only when the
// envelope doesn't already carry one). Preserves the exact behavior of the
// previous inline `normalizeArtifact`.
function normalizeChart(value: Record<string, unknown>): Record<string, unknown> {
  const data = value.data;
  if (!isPlainObject(data)) return value;
  const labels = Array.isArray(data.labels)
    ? data.labels
    : isPlainObject(data.xAxis) && Array.isArray(data.xAxis.values)
      ? data.xAxis.values
      : null;
  if (!labels || !Array.isArray(data.series) || !data.series.every(isPlainObject)) return value;

  return {
    ...value,
    ...(value.title === undefined && typeof data.title === "string" ? { title: data.title } : {}),
    data: {
      chartType: data.chartType,
      labels,
      series: data.series.map((series) => ({ label: series.label ?? series.name, values: series.values })),
    },
  };
}

registerKind({
  kind: "chart",
  label: "Chart",
  promptSpec: `data:{chartType:"bar"|"line",labels:string[],series:[{label:string,values:number[]}]}`,
  normalize: normalizeChart,
  validate(data): { ok: true; data: ChartData } | { ok: false; reason: string } {
    const d = data as Record<string, unknown>;
    if (!hasOnlyKeys(d, ["chartType", "labels", "series"]) || (d.chartType !== "bar" && d.chartType !== "line") || !stringArray(d.labels, 60, 1000) || !Array.isArray(d.series) || d.series.length > 12) {
      return { ok: false, reason: "Chart data contains invalid types or limits" };
    }
    const series: ChartData["series"] = [];
    for (const entry of d.series) {
      if (!isPlainObject(entry) || !hasOnlyKeys(entry, ["label", "values"]) || !boundedString(entry.label, 1000) || !Array.isArray(entry.values) || entry.values.length !== d.labels.length || entry.values.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
        return { ok: false, reason: "Chart series must match labels and contain finite numbers" };
      }
      series.push({ label: entry.label, values: entry.values });
    }
    return { ok: true, data: { chartType: d.chartType, labels: d.labels, series } };
  },
});
