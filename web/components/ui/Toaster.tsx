"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/** App-wide toast viewport. Mounted once in the App Shell so toasts work on
 *  every surface. Themed onto the paper/ink palette via inline styles reading
 *  the live CSS variables (Sonner renders outside our Tailwind tree). */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "rounded-card border border-border-strong bg-surface text-content shadow-float font-sans",
          title: "font-serif text-[14px] font-semibold text-ink",
          description: "text-[12px] text-content-muted",
          actionButton: "bg-ink text-paper-2",
          cancelButton: "bg-surface-2 text-content-muted",
        },
      }}
      {...props}
    />
  );
}
