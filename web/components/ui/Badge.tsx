import * as React from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "accent" | "feynman" | "strong" | "learning" | "slipping" | "untested";

const tones: Record<Tone, string> = {
  neutral: "border-border bg-surface text-content-muted",
  accent: "border-rule/40 bg-rule/10 text-rule",
  feynman: "border-feynman/40 bg-feynman/10 text-feynman",
  strong: "border-band-strong/40 bg-band-strong/10 text-band-strong",
  learning: "border-band-learning/40 bg-band-learning/10 text-band-learning",
  slipping: "border-band-slipping/40 bg-band-slipping/10 text-band-slipping",
  untested: "border-band-untested/40 bg-band-untested/10 text-band-untested",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

/** Small mono label — replaces .chip and the Feynman "F" tag. Non-interactive
 *  by default; pass a <button> via asChild-free composition if you need clicks. */
export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "mono inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-[1.4] whitespace-nowrap",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
