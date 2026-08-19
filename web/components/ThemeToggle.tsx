"use client";

import { useEffect, useRef, useState } from "react";
import { Sun, Moon } from "lucide-react";

type Theme = "light" | "dark";

// Icon toggle. The no-flash script in layout.tsx sets <html data-theme> before
// paint; this component reconciles from the settings DB on mount and flips it
// on click, mirroring to localStorage (no-flash on reload) and the settings DB
// (cross-session source). Lives in the rail footer; sized to match IconButton.
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);
  // Set true on the first explicit toggle so a slow in-flight DB reconcile
  // (fired at mount) can't revert the user's choice once it resolves.
  const toggledRef = useRef(false);

  useEffect(() => {
    const current = (document.documentElement.dataset.theme as Theme) || "light";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(current);
    setMounted(true);
    // Reconcile with the DB (authoritative) in case it changed elsewhere —
    // but only if the user hasn't toggled since mount, and against the live
    // data-theme at resolve time rather than the stale mount snapshot.
    fetch("/api/settings")
      .then((r) => r.json())
      .then((c: { raw?: { theme?: string } }) => {
        if (toggledRef.current) return;
        const db = c.raw?.theme === "dark" ? "dark" : "light";
        const live = (document.documentElement.dataset.theme as Theme) || "light";
        if (db !== live) applyTheme(db);
      })
      .catch(() => {});
  }, []);

  function applyTheme(t: Theme) {
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("studygpt-theme", t);
    } catch {
      // storage unavailable (private mode) — non-fatal
    }
    setTheme(t);
  }

  function toggle() {
    toggledRef.current = true;
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: next }),
    }).catch(() => {});
  }

  const isDark = mounted ? theme === "dark" : false;
  const label = `Switch to ${isDark ? "light" : "dark"} theme`;

  return (
    <button
      onClick={toggle}
      aria-label={label}
      title={label}
      className="inline-flex h-10 w-10 items-center justify-center rounded-control text-content-faint transition-[transform,background-color,color] duration-fast ease-out hover:-translate-y-px hover:bg-surface hover:text-content focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2 outline-none"
    >
      {/* Render a stable icon until mounted to avoid a hydration mismatch; the
          no-flash script has already set the correct page theme. */}
      {isDark ? <Sun size={17} strokeWidth={1.75} /> : <Moon size={17} strokeWidth={1.75} />}
    </button>
  );
}
