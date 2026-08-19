"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/cn";

export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring-accent/60 data-[state=checked]:border-rule data-[state=checked]:bg-rule data-[state=unchecked]:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block h-3.5 w-3.5 rounded-full bg-paper-2 shadow-sm transition-transform duration-fast ease-out data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-[3px]",
        )}
      />
    </SwitchPrimitive.Root>
  );
}