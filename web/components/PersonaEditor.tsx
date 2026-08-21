"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
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
        className="mono inline-flex items-center gap-1 rounded-control border border-border bg-surface-2 px-2 py-1 text-[10px] tracking-wide text-content-muted transition-colors hover:border-border-strong hover:text-content"
        aria-label="Choose teacher persona"
      >
        <span aria-hidden>◌</span>
        {compact ? "teacher" : selected.label}
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 px-4" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="teacher-persona-title"
            onMouseDown={(event) => event.stopPropagation()}
            className="w-full max-w-[540px] rounded-card border border-border-strong bg-surface p-5 text-content shadow-float"
            style={{ backgroundColor: "var(--surface)" }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="mono text-[10px] tracking-[0.12em] text-content-faint">TEACHER STYLE</p>
                <h2 id="teacher-persona-title" className="mt-1 font-serif text-[20px] leading-tight text-content">
                  How should I teach you?
                </h2>
                <p className="mt-1 text-[13px] leading-relaxed text-content-muted">
                  This changes tone, pacing, and examples. It cannot override source or safety rules.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-[18px] leading-none text-content-faint transition-colors hover:text-content" aria-label="Close">
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
                    className={`rounded-control border p-3 text-left transition-colors ${active ? "border-feynman bg-feynman/10" : "border-border bg-paper hover:border-border-strong"}`}
                  >
                    <span className="text-[13px] font-medium text-content">{item.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-content-muted">{item.description}</span>
                  </button>
                );
              })}
            </div>

            <label className="mt-4 block">
              <span className="mono text-[10px] tracking-wide text-content-faint">Learning context (optional)</span>
              <textarea
                value={context}
                onChange={(event) => {
                  setContext(event.target.value);
                  setError(null);
                }}
                maxLength={MAX_PERSONA_CONTEXT}
                rows={4}
                placeholder="I am new to this. Use football examples, explain slowly, and check me after each idea."
                className="mt-1.5 w-full resize-y rounded-control border border-border bg-paper px-3 py-2 text-[13px] leading-relaxed text-content outline-none transition-colors placeholder:text-content-faint focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="mono mt-1 flex justify-between text-[9px] text-content-faint">
                <span>Describe your level, goals, pace, and useful examples.</span>
                <span>{context.length}/{MAX_PERSONA_CONTEXT}</span>
              </span>
            </label>

            {error && <p className="mono mt-2 text-[11px] text-rule">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="mono rounded-control px-3 py-1.5 text-[11px] text-content-muted transition-colors hover:text-content">
                cancel
              </button>
              <button type="button" onClick={save} disabled={saving} className="mono rounded-control bg-content px-4 py-1.5 text-[11px] text-paper disabled:opacity-50">
                {saving ? "saving…" : "save teacher"}
              </button>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
