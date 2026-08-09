"use client";

import Link from "next/link";
import type { Project } from "@/lib/db/schema";

interface Props {
  projects: Project[];
  activeProjectId: string | null;
  onChange: (id: string | null) => void;
}

export function ProjectSwitcher({ projects, activeProjectId, onChange }: Props) {
  return (
    <div className="px-3 pb-2">
      <div className="mono flex items-center gap-1.5">
        <select
          value={activeProjectId ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          aria-label="Project"
          className="mono w-full rounded-[3px] border border-line bg-paper-2 px-2 py-1.5 text-[12px] text-ink outline-none focus:border-ink/40"
        >
          <option value="">Standalone</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <Link
          href="/projects"
          aria-label="Manage projects"
          className="mono shrink-0 text-ink-3 transition-colors hover:text-ink"
        >
          ⌗
        </Link>
      </div>
    </div>
  );
}