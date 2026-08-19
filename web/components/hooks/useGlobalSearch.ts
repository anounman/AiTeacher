"use client";

import { useCallback, useEffect, useState } from "react";
import type { GlobalSearchResult } from "@/lib/chat/global-search";

// Global command-palette state + debounced search + keyboard shortcut, extracted
// from app/(app)/page.tsx. Owns: open state, query, results, loading, the
// keyboard-navigable active index, the 140ms debounced fetch against
// /api/search?q=<query>&projectId=<activeProjectId>, and the Cmd/Ctrl+K
// shortcut. The palette UI (CommandPalette) consumes these values; the page
// wires onSelect to result navigation. `activeProjectId` scopes the search
// (null = global across all projects) and re-fires the debounce on change.
export function useGlobalSearch(activeProjectId: string | null) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Debounced fetch. 140ms after the query (or scope) settles, hit the typed
  // search endpoint; abort the in-flight request when the query changes again.
  useEffect(() => {
    const value = query.trim();
    if (!open || value.length < 2) {
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      const searchParams = new URLSearchParams({ q: value });
      if (activeProjectId) searchParams.set("projectId", activeProjectId);
      fetch(`/api/search?${searchParams}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : { results: [] }))
        .then((data: { results?: GlobalSearchResult[] }) => setResults(data.results ?? []))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 140);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [activeProjectId, open, query]);

  // Clamp the active index to the result range so keyboard navigation can't
  // land on a now-missing row after the results list shrinks.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveIndex((current) =>
      results.length === 0 ? -1 : Math.min(Math.max(current, 0), results.length - 1),
    );
  }, [results]);

  // Cmd/Ctrl+K opens the palette. Bound once for the page lifetime.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const setQueryAndResetIndex = useCallback((value: string) => {
    setQuery(value);
    setActiveIndex(-1);
  }, []);

  const openPalette = useCallback(() => setOpen(true), []);
  // Closing also resets the active index so a reopen starts at the top.
  const closePalette = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);
  // The onOpenChange handler for the dialog: only resets the index on close.
  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setActiveIndex(-1);
  }, []);

  return {
    open,
    query,
    results,
    loading,
    activeIndex,
    setQuery: setQueryAndResetIndex,
    setActiveIndex,
    openPalette,
    closePalette,
    onOpenChange,
  };
}