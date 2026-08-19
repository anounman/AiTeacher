import { BrainCircuit, BookOpen, ChevronDown, Globe2, Layers3 } from "lucide-react";
import type { MessageActivity, MessageGrounding } from "@/lib/db/schema";

type Props = {
  activities?: MessageActivity[];
  grounding?: MessageGrounding | null;
};

export function AnswerInsights({ activities = [], grounding = null }: Props) {
  if (activities.length === 0 && !grounding) return null;

  const groundingFacts = [
    grounding && grounding.sourceCount > 0
      ? `${grounding.sourceCount} course passage${grounding.sourceCount === 1 ? "" : "s"}`
      : null,
    grounding?.usedWeb ? "web search" : null,
    grounding?.usedNotation ? "course notation" : null,
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <details className="group/insights mt-4 rounded-control border border-border/80 bg-surface-2/35 px-3 py-2.5 text-[12px] text-content-muted">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-content-faint outline-none transition-colors hover:text-content focus-visible:text-content">
        <BrainCircuit size={13} strokeWidth={1.8} className="text-rule" />
        <span className="mono flex-1">How this answer was prepared</span>
        <ChevronDown size={13} className="transition-transform group-open/insights:rotate-180" />
      </summary>
      <div className="mt-3 space-y-3 border-t border-border/70 pt-3">
        {activities.length > 0 && (
          <ol className="space-y-1.5">
            {activities.map((activity) => (
              <li key={`${activity.ordinal}-${activity.phase}`} className="flex items-start gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-rule/80" />
                <span>{activity.label}</span>
              </li>
            ))}
          </ol>
        )}
        {(groundingFacts.length > 0 || grounding?.model) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-content-faint">
            {grounding?.sourceCount ? <span className="inline-flex items-center gap-1"><BookOpen size={12} />{groundingFacts[0]}</span> : null}
            {grounding?.usedWeb ? <span className="inline-flex items-center gap-1"><Globe2 size={12} />web search</span> : null}
            {grounding?.usedNotation ? <span className="inline-flex items-center gap-1"><Layers3 size={12} />course notation</span> : null}
            {grounding?.model ? <span className="mono">{grounding.model}</span> : null}
          </div>
        )}
      </div>
    </details>
  );
}
