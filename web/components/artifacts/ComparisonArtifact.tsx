interface ComparisonArtifactProps {
  items: { label: string; value: string; detail?: string }[];
}

export function ComparisonArtifact({ items }: ComparisonArtifactProps) {
  return (
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-control border border-border/70 bg-surface/50 px-3 py-2.5">
          <dt className="mono text-[10px] tracking-wide text-content-faint">{item.label}</dt>
          <dd className="mt-1 text-[13px] font-medium text-content">{item.value}</dd>
          {item.detail && <dd className="mt-1 text-[12px] leading-relaxed text-content-muted">{item.detail}</dd>}
        </div>
      ))}
    </dl>
  );
}
