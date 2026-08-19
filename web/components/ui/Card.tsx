import * as React from "react";
import { cn } from "@/lib/cn";

/** Notebook-page surface: fresh-paper card. `accent` pins the signature red
 *  margin rule (2px) to the left edge — the evolved .page-card pattern, but
 *  composable (a child bar instead of a ::before so it nests cleanly). */
export function Card({
  className,
  accent = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { accent?: boolean }) {
  return (
    <div
      className={cn(
        "relative border border-border bg-surface rounded-card shadow-card",
        className,
      )}
      {...props}
    >
      {accent && (
        <span
          aria-hidden
          className="absolute left-0 top-4 bottom-4 w-[3px] rounded-full bg-rule"
        />
      )}
      {props.children}
    </div>
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 pb-2", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("font-serif text-[1.05rem] font-semibold leading-tight text-ink", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 pt-2", className)} {...props} />;
}
