import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/cn";

type Variant = "ghost" | "solid";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  ghost:
    "bg-transparent text-content-muted hover:bg-surface-2 hover:text-content focus-visible:ring-ring",
  solid:
    "bg-surface border border-border text-content hover:bg-surface-2 hover:border-border-strong focus-visible:ring-ring",
};

const sizes: Record<Size, string> = {
  sm: "h-8 w-8 rounded-control",
  md: "h-10 w-10 rounded-control",
  lg: "h-11 w-11 rounded-control",
};

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Visible text for screen readers + the rail tooltip (caller wraps in Tooltip). */
  label: string;
  asChild?: boolean;
}

/** Square icon-only button. `label` is required for accessibility — it becomes
 *  the aria-label. Use inside <Tooltip> for a hover label. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant = "ghost", size = "md", label, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex items-center justify-center leading-none transition-[transform,background-color,color,border-color,box-shadow] duration-fast ease-out hover:-translate-y-px active:translate-y-0 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:pointer-events-none disabled:opacity-40",
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  },
);
IconButton.displayName = "IconButton";
