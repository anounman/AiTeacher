// A bare loading placeholder. `bg-ink/10` uses Tailwind v4 color-mix, so it
// reads as a faint gray bar on paper in light mode and a faint light bar on
// dark paper — one class works in both themes. `animate-pulse` drives the
// shimmer; the global `@media (prefers-reduced-motion)` rule zeroes its
// duration, so skeletons sit still when the user opts out of motion.
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-control bg-ink/10 ${className}`} />;
}
