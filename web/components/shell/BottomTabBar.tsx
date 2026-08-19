"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { NAV, isNavActive } from "./nav";
import { cn } from "@/lib/cn";
import { useLayoutMotion } from "@/lib/motion";

// Mobile navigation — a fixed bottom tab bar shown only below the `tab`
// breakpoint (the desktop Rail is hidden there). Safe-area padding keeps it
// clear of the home indicator on notched devices.
export function BottomTabBar() {
  const pathname = usePathname();
  const layoutTransition = useLayoutMotion();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-3 bottom-3 z-40 flex rounded-card border border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-float backdrop-blur-md tab:hidden"
    >
      {NAV.map((item) => {
        const active = isNavActive(pathname, item);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors duration-fast ease-out",
              active ? "text-ink" : "text-content-faint",
            )}
          >
            <span className="relative inline-flex h-6 w-6 items-center justify-center">
              {active && (
                <motion.span
                  aria-hidden
                  layoutId="active-bottom-tab-indicator"
                  transition={layoutTransition}
                  className="absolute -top-1 h-[3px] w-5 rounded-full bg-rule"
                />
              )}
              <Icon size={19} strokeWidth={1.75} />
            </span>
            <span className="mono text-[9px] tracking-wide">{item.label.toLowerCase()}</span>
          </Link>
        );
      })}
    </nav>
  );
}
