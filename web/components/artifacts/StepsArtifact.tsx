interface StepsArtifactProps {
  items: { title: string; detail: string; emphasis?: "default" | "key" }[];
}

export function StepsArtifact({ items }: StepsArtifactProps) {
  return (
    <ol className="space-y-3">
      {items.map((item, index) => (
        <li key={`${item.title}-${index}`} className="flex gap-3">
          <span className="mono flex h-6 w-6 shrink-0 items-center justify-center rounded-control border border-border text-[10px] tabular-nums text-content-faint">
            {index + 1}
          </span>
          <div className={item.emphasis === "key" ? "border-l-2 border-rule pl-3" : "pl-3"}>
            <p className={item.emphasis === "key" ? "font-medium text-rule" : "font-medium text-content"}>{item.title}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-content-muted">{item.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
