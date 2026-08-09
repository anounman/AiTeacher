"use client";

import Link from "next/link";
import type { Conversation, Project } from "@/lib/db/schema";
import { ThemeToggle } from "./ThemeToggle";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { Skeleton } from "./Skeleton";

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
  projects: Project[];
  activeProjectId: string | null;
  onProjectChange: (id: string | null) => void;
  // True until the first conversations fetch resolves. While true AND the list
  // is empty, show skeleton rows instead of "no conversations yet" — otherwise
  // every load briefly looks like an empty account.
  loading?: boolean;
  creating?: boolean;
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  query,
  onQueryChange,
  projects,
  activeProjectId,
  onProjectChange,
  loading = false,
  creating = false,
}: Props) {
  const scoped = activeProjectId
    ? conversations.filter((c) => c.project_id === activeProjectId)
    : conversations.filter((c) => !c.project_id);
  const q = query.trim().toLowerCase();
  const filtered = q ? scoped.filter((c) => c.title.toLowerCase().includes(q)) : scoped;

  return (
    <aside className="app-sidebar margin-rule flex h-full w-64 shrink-0 flex-col bg-paper-3">
      <header className="flex items-center justify-between px-4 py-3.5">
        <span className="mono flex items-center gap-2 text-[13px] font-medium tracking-wide text-ink">
          <span className="h-1.5 w-1.5 rounded-full bg-rule" />
          StudyGPT
        </span>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            href="/decks"
            aria-label="Flashcard decks"
            className="mono text-ink-3 transition-colors hover:text-ink"
          >
            ▤
          </Link>
          <Link
            href="/review"
            aria-label="Review"
            className="mono text-ink-3 transition-colors hover:text-ink"
          >
            ⟳
          </Link>
          <Link
            href="/mastery"
            aria-label="Mastery"
            className="mono text-ink-3 transition-colors hover:text-ink"
          >
            ◆
          </Link>
          <Link
            href="/settings"
            aria-label="Settings"
            className="mono text-ink-3 transition-colors hover:text-ink"
          >
            ⚙
          </Link>
        </div>
      </header>

      <ProjectSwitcher
        projects={projects}
        activeProjectId={activeProjectId}
        onChange={onProjectChange}
      />

      <div className="px-3 pb-2">
        <button
          onClick={onNew}
          disabled={creating}
          className="mono w-full rounded-[3px] border border-line bg-paper-2 px-3 py-2 text-[12px] tracking-wide text-ink transition-colors hover:border-ink/40 disabled:cursor-wait disabled:opacity-60"
        >
          {creating ? "starting…" : "+ new conversation"}
        </button>
      </div>

      <div className="px-3 pb-1">
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="search"
          className="mono w-full rounded-[3px] border border-line bg-paper-2 px-2.5 py-1.5 text-[12px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-ink/40"
        />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-3 pt-1">
        {loading && scoped.length === 0 && (
          <div className="px-1 pt-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-2">
                <Skeleton className="h-3.5 flex-1" />
                <Skeleton className="h-3 w-4" />
              </div>
            ))}
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <p className="mono px-2 py-4 text-[11px] text-ink-3">
            {scoped.length === 0
              ? activeProjectId
                ? "no conversations in this project"
                : "no conversations yet"
              : "no matches"}
          </p>
        )}
        {filtered.map((c) => {
          const active = c.id === activeId;
          return (
            <div
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={`group relative cursor-pointer rounded-[3px] px-3 py-2 text-[14px] transition-colors ${
                active ? "bg-paper-2" : "hover:bg-paper-2/60"
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-rule" />
              )}
              <div className="flex items-center gap-1.5">
                <span className="flex-1 truncate leading-snug text-ink">{c.title}</span>
                {c.mode === "feynman" && (
                  <span className="mono rounded-[2px] bg-feynman/10 px-1 py-px text-[9px] font-medium text-feynman">
                    F
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(c.id);
                  }}
                  aria-label="Delete conversation"
                  className="mono opacity-0 transition-opacity group-hover:opacity-100 hover:text-rule"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
