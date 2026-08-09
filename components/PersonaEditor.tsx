"use client";

import { useState } from "react";
import {
  MAX_PERSONA_CONTEXT,
  PERSONA_PRESETS,
  validatePersonaContext,
} from "@/lib/persona";
import type { Conversation, TeacherPersonaPreset } from "@/lib/db/schema";

export function PersonaEditor({
  conversation,
  onUpdated,
  compact = false,
}: {
  conversation: Conversation;
  onUpdated: (conversation: Conversation) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<TeacherPersonaPreset>(conversation.persona_preset);
  const [context, setContext] = useState(conversation.persona_context);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = PERSONA_PRESETS.find((item) => item.id === conversation.persona_preset) ?? PERSONA_PRESETS[0];

  async function save() {
    const validation = validatePersonaContext(context);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaPreset: preset, personaContext: validation.value }),
      });
      const body = await response.json().catch(() => null) as (Conversation & { error?: string }) | null;
      if (!response.ok || !body) throw new Error(body?.error || "Could not save the teacher style.");
      onUpdated(body);
      setContext(body.persona_context);
      setPreset(body.persona_preset);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the teacher style.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setPreset(conversation.persona_preset);
          setContext(conversation.persona_context);
          setError(null);
          setOpen(true);
        }}
        className="mono inline-flex items-center gap-1 rounded-[3px] border border-line bg-paper-2 px-2 py-1 text-[10px] tracking-wide text-ink-2 transition-colors hover:border-ink/40 hover:text-ink"
        aria-label="Choose teacher persona"
      >
        <span aria-hidden>◌</span>
        {compact ? "teacher" : selected.label}
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 px-4" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="teacher-persona-title"
            onMouseDown={(event) => event.stopPropagation()}
            className="w-full max-w-[540px] rounded-[5px] border border-line bg-paper-2 p-5 text-ink shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow">Teacher style</p>
                <h2 id="teacher-persona-title" className="mt-1 text-[20px] leading-tight text-ink">
                  How should I teach you?
                </h2>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
                  This changes tone, pacing, and examples. It cannot override source or safety rules.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="mono text-[14px] text-ink-3 hover:text-ink" aria-label="Close">
                ×
              </button>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {PERSONA_PRESETS.map((item) => {
                const active = item.id === preset;
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => setPreset(item.id)}
                    className={`rounded-[4px] border p-3 text-left transition-colors ${active ? "border-feynman bg-feynman/10" : "border-line bg-paper hover:border-ink/30"}`}
                  >
                    <span className="text-[13px] font-medium text-ink">{item.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-3">{item.description}</span>
                  </button>
                );
              })}
            </div>

            <label className="mt-4 block">
              <span className="mono text-[10px] tracking-wide text-ink-3">Learning context (optional)</span>
              <textarea
                value={context}
                onChange={(event) => {
                  setContext(event.target.value);
                  setError(null);
                }}
                maxLength={MAX_PERSONA_CONTEXT}
                rows={4}
                placeholder="I am new to this. Use football examples, explain slowly, and check me after each idea."
                className="mt-1.5 w-full resize-y rounded-[4px] border border-line bg-paper px-3 py-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-ink/40"
              />
              <span className="mono mt-1 flex justify-between text-[9px] text-ink-3">
                <span>Describe your level, goals, pace, and useful examples.</span>
                <span>{context.length}/{MAX_PERSONA_CONTEXT}</span>
              </span>
            </label>

            {error && <p className="mono mt-2 text-[11px] text-rule">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="mono rounded-[3px] px-3 py-1.5 text-[11px] text-ink-3 hover:text-ink">
                cancel
              </button>
              <button type="button" onClick={save} disabled={saving} className="mono rounded-[3px] bg-ink px-4 py-1.5 text-[11px] text-paper-2 disabled:opacity-50">
                {saving ? "saving…" : "save teacher"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
