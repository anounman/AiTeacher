import { useId } from "react";

interface ChartArtifactProps {
  chartType: "bar" | "line";
  labels: string[];
  series: { label: string; values: number[] }[];
  title?: string;
  summary?: string;
}

const WIDTH = 640;
const HEIGHT = 300;
const PADDING = { top: 20, right: 24, bottom: 52, left: 58 };

function tickIndexes(length: number): number[] {
  const stride = Math.max(1, Math.ceil((length - 1) / 7));
  return Array.from({ length }, (_, index) => index).filter((index) => index % stride === 0 || index === length - 1);
}

function formatValue(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function ChartArtifact({ chartType, labels, series, title, summary }: ChartArtifactProps) {
  const chartId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const values = series.flatMap((entry) => entry.values.filter(Number.isFinite));
  if (!labels.length || !series.length || !values.length) {
    return <p className="mono rounded-control border border-border/70 bg-surface/50 px-3 py-2 text-[11px] text-content-faint">Chart data is unavailable.</p>;
  }

  const minimum = Math.min(0, ...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const x = (index: number) => PADDING.left + (labels.length === 1 ? plotWidth / 2 : (index / (labels.length - 1)) * plotWidth);
  const y = (value: number) => PADDING.top + ((maximum - value) / range) * plotHeight;
  const zeroY = y(0);
  const xTicks = tickIndexes(labels.length);
  const yTicks = Array.from({ length: 5 }, (_, index) => minimum + (range * index) / 4);
  const chartTitle = title ?? "Chart";
  const description = summary ?? `${chartType} chart showing ${series.map((entry) => entry.label).join(", ")} across ${labels.join(", ")}.`;
  const barWidth = Math.max(8, plotWidth / labels.length / Math.max(series.length + 1, 2));

  return (
    <div className="mx-auto w-full max-w-5xl overflow-hidden">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby={`artifact-chart-title-${chartId} artifact-chart-description-${chartId}`} className="h-[min(22rem,44vw)] min-h-60 w-full text-content">
        <title id={`artifact-chart-title-${chartId}`}>{chartTitle}</title>
        <desc id={`artifact-chart-description-${chartId}`}>{description}</desc>
        {yTicks.map((value) => <g key={value} data-chart-grid><line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y(value)} y2={y(value)} stroke="currentColor" strokeOpacity="0.12" /><text x={PADDING.left - 10} y={y(value) + 4} textAnchor="end" className="fill-current text-[10px] text-content-faint">{formatValue(value)}</text></g>)}
        <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={zeroY} y2={zeroY} stroke="currentColor" strokeOpacity="0.4" />
        {xTicks.map((index) => <text key={labels[index]} data-chart-tick x={x(index)} y={HEIGHT - 18} textAnchor="middle" className="fill-current text-[10px] text-content-faint">{labels[index]}</text>)}
        {series.map((entry, seriesIndex) => {
          const className = seriesIndex === 0 ? "text-rule" : "text-content-muted";
          if (chartType === "bar") {
            return entry.values.map((value, index) => Number.isFinite(value) && (
              <rect key={`${entry.label}-${index}`} x={x(index) - (series.length * barWidth) / 2 + seriesIndex * barWidth} y={Math.min(y(value), zeroY)} width={barWidth - 2} height={Math.abs(zeroY - y(value))} className={className} fill="currentColor">
                <title>{`${entry.label}: ${labels[index]} ${value}`}</title>
              </rect>
            ));
          }
          const points = entry.values.map((value, index) => Number.isFinite(value) ? `${x(index)},${y(value)}` : "").filter(Boolean).join(" ");
          return (
            <g key={entry.label} className={className}>
              <polyline fill="none" stroke="currentColor" strokeWidth="2" points={points} aria-label={entry.label} />
              {entry.values.map((value, index) => Number.isFinite(value) && <circle key={`${entry.label}-${index}`} cx={x(index)} cy={y(value)} r="3" fill="currentColor"><title>{`${entry.label}: ${labels[index]} ${value}`}</title></circle>)}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
