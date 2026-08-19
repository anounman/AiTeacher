import * as React from "react";
import { cn } from "@/lib/cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-control border border-border bg-surface px-3.5 text-[13px] text-content shadow-sm transition-[border-color,box-shadow,background-color] duration-fast ease-out outline-none hover:border-border-strong hover:bg-paper focus:border-border-strong focus-visible:ring-2 focus-visible:ring-ring-accent/60 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
