"use client";

import { BrainCircuit, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ProjectMemoryEntry } from "@/lib/db/schema";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";

type Props = {
  entries: ProjectMemoryEntry[];
  onAdd: (content: string) => void;
  onToggle: (entry: ProjectMemoryEntry, active: boolean) => void;
  onDelete: (entry: ProjectMemoryEntry) => void;
};

export function ProjectMemory({ entries, onAdd, onToggle, onDelete }: Props) {
  const [draft, setDraft] = useState("");
  function submit() {
    const value = draft.trim();
    if (!value) return;
    onAdd(value);
    setDraft("");
  }
  return (
    <section className="mb-5 border-b border-border pb-4">
      <div className="mb-2 flex items-center gap-2"><BrainCircuit size={14} className="text-rule" /><div><p className="text-[13px] font-medium text-content">Tutor memory</p><p className="text-[11px] text-content-faint">Active notes tailor future answers in this project.</p></div></div>
      <div className="flex gap-2"><Input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submit(); } }} placeholder="e.g. Use Chen notation for ER diagrams" className="text-[12px]" /><Button variant="secondary" size="sm" onClick={submit}><Plus size={14} />add</Button></div>
      {entries.length > 0 && <ul className="mt-3 space-y-1.5">{entries.map((entry) => <li key={entry.id} className="flex items-center gap-2 rounded-control bg-surface-2/55 px-2.5 py-2"><Switch checked={entry.active} onCheckedChange={(active) => onToggle(entry, active)} aria-label={`Use memory: ${entry.content}`} /><span className={`min-w-0 flex-1 text-[12px] ${entry.active ? "text-content" : "text-content-faint line-through"}`}>{entry.content}</span><IconButton label="Remove memory" size="sm" onClick={() => onDelete(entry)}><Trash2 size={12} /></IconButton></li>)}</ul>}
    </section>
  );
}
