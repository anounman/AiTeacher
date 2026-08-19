import { cn } from "@/lib/cn";

interface CalloutArtifactProps {
  label?: string;
  body: string;
  tone?: "idea" | "warning" | "formula";
}

const toneClasses = {
  idea: "border-rule text-rule",
  warning: "border-danger text-danger",
  formula: "border-ink/40 text-ink",
} as const;

export function CalloutArtifact({ label, body, tone = "idea" }: CalloutArtifactProps) {
  return (
    <aside className={cn("border-l-2 pl-3", toneClasses[tone])}>
      {label && <p className="mono text-[10px] font-medium tracking-wide">{label}</p>}
      <p className={cn("text-[13px] leading-relaxed", label && "mt-1")}>{body}</p>
    </aside>
  );
}
