"use client";

import { Bot, Eye, MessageSquareText } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/Select";

export type ModelOption = {
  id: string;
  vision: boolean;
};

export function ModelSwitcher({
  value,
  models,
  onChange,
}: {
  value: string;
  models: ModelOption[];
  onChange: (model: string) => void;
}) {
  // Ensure the current value is always selectable, even before the backend
  // model list loads (models=[] on first render) or when the conversation's
  // stored model no longer exists on the backend. Dedupe by id so a backend
  // that lists the same model id twice (Ollama can) can't produce duplicate
  // React keys in the SelectItem list.
  const options = (() => {
    const hasValue = models.some((model) => model.id === value);
    const list = hasValue ? models : [{ id: value, vision: false }, ...models];
    const seen = new Set<string>();
    return list.filter((model) => {
      if (seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    });
  })();
  const selected = options.find((model) => model.id === value) ?? options[0];

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label="Choose model"
        className="h-11 w-[min(15rem,36vw)] rounded-card border-border bg-surface/80 px-2.5 py-1.5 shadow-none hover:bg-surface-2 focus-visible:ring-ring-accent/60"
      >
        <span className="flex min-w-0 items-center gap-2.5 text-left">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-ink/5 text-rule dark:bg-white/5">
            <Bot size={15} strokeWidth={2.2} />
          </span>
          <span className="min-w-0">
            <span className="mono block text-[9px] font-medium leading-none tracking-[0.14em] text-content-faint">MODEL</span>
            <span className="mt-1 flex items-center gap-1.5 truncate font-mono text-[11px] leading-none text-content">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${selected?.vision ? "bg-feynman" : "bg-content-faint"}`} />
              <span className="truncate">{value}</span>
            </span>
          </span>
        </span>
      </SelectTrigger>
      <SelectContent className="w-[min(21rem,calc(100vw-2rem))] rounded-card border-border-strong bg-surface p-1.5 shadow-float">
        <div className="pointer-events-none flex items-start justify-between gap-4 px-2.5 pb-2 pt-1">
          <div>
            <p className="mono text-[10px] font-medium tracking-[0.14em] text-content-faint">AVAILABLE MODELS</p>
            <p className="mt-0.5 text-[11px] text-content-muted">Choose the tutor for this conversation.</p>
          </div>
          <span className="mono rounded-control bg-surface-2 px-2 py-1 text-[10px] text-content-faint">{options.length}</span>
        </div>
        <div className="border-t border-border pt-1">
          {options.map((model) => (
            <SelectItem
              key={model.id}
              value={model.id}
              className="min-h-14 rounded-card py-2 pl-8 pr-2.5 data-[highlighted]:bg-surface-2"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2.5">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-control ${model.vision ? "bg-feynman/10 text-feynman" : "bg-surface-2 text-content-faint"}`}>
                  {model.vision ? <Eye size={14} strokeWidth={2.2} /> : <MessageSquareText size={14} strokeWidth={2.2} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[12px] text-content">{model.id}</span>
                  <span className="mt-0.5 block text-[10px] text-content-faint">{model.vision ? "Vision ready" : "Text model"}</span>
                </span>
                <span className={`mono shrink-0 rounded-control px-1.5 py-1 text-[9px] tracking-wide ${model.vision ? "bg-feynman/10 text-feynman" : "bg-surface-2 text-content-faint"}`}>
                  {model.vision ? "VISION" : "TEXT"}
                </span>
              </span>
            </SelectItem>
          ))}
        </div>
      </SelectContent>
    </Select>
  );
}
