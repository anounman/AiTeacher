"use client";

import Link from "next/link";
import { FolderKanban, GraduationCap } from "lucide-react";
import type { Project } from "@/lib/db/schema";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/Select";
import { IconButton } from "@/components/ui/IconButton";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/Tooltip";

interface Props {
  projects: Project[];
  activeProjectId: string | null;
  onChange: (id: string | null) => void;
}

export function ProjectSwitcher({ projects, activeProjectId, onChange }: Props) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <Select
          value={activeProjectId ?? "__standalone__"}
          onValueChange={(v) => onChange(v === "__standalone__" ? null : v)}
        >
          <SelectTrigger aria-label="Project">
            <SelectValue placeholder="Standalone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__standalone__">Standalone</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.study_enabled && (
                  <GraduationCap size={12} strokeWidth={1.75} className="mr-1 inline text-content-faint" />
                )}
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              asChild
              label="Manage projects"
              size="md"
              variant="solid"
              className="shrink-0"
            >
              <Link href="/projects">
                <FolderKanban size={15} />
              </Link>
            </IconButton>
          </TooltipTrigger>
          <TooltipContent side="bottom">Manage projects</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}