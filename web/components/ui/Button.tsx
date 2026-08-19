import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "accent" | "danger";
type Size = "sm" | "md" | "icon";

const variants: Record<Variant, string> = {
  // Filled ink — the old .btn-primary pattern, now sans chrome.
  primary:
    "bg-ink text-paper-2 shadow-sm hover:-translate-y-px hover:opacity-90 active:translate-y-0 active:opacity-100 focus-visible:ring-ring",
  secondary:
    "border border-border bg-surface text-content shadow-sm hover:-translate-y-px hover:bg-surface-2 hover:border-border-strong active:translate-y-0 focus-visible:ring-ring",
  ghost:
    "bg-transparent text-content-muted hover:bg-surface-2 hover:text-content focus-visible:ring-ring",
  accent:
    "bg-rule text-white hover:opacity-90 active:opacity-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring-accent focus-visible:ring-offset-paper",
  danger:
    "bg-danger text-white hover:opacity-90 active:opacity-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring focus-visible:ring-offset-paper",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-control",
  md: "h-10 px-4 text-[13px] gap-2 rounded-control",
  icon: "h-10 w-10 rounded-control justify-center",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
}

/** Studio Notebook button. Sans chrome (Inter), mono only when caller opts in
 *  via className. `asChild` renders the child (e.g. a next/link) as the button. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(
          "inline-flex items-center font-medium leading-none whitespace-nowrap select-none transition-[transform,opacity,background-color,border-color,color,box-shadow] duration-fast ease-out outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:pointer-events-none disabled:opacity-50",
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
