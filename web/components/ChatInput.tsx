"use client";

import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent, type ClipboardEvent } from "react";
import {
  Plus,
  Globe,
  Mic,
  Loader2,
  Square,
  ArrowUp,
  X,
  Check,
  FolderPlus,
  Paperclip,
} from "lucide-react";
import type { Attachment } from "@/lib/db/schema";
import { Button } from "@/components/ui/Button";
import { useVoiceTyping } from "@/components/chat/useVoiceTyping";
import { cn } from "@/lib/cn";

interface Props {
  onSend: (text: string, attachments: Attachment[], document: boolean, web: boolean) => void;
  disabled?: boolean;
  placeholder?: string;
  streaming?: boolean;
  onStop?: () => void;
  projectId?: string | null;
  // True when the server has an OpenAI key configured for Whisper transcription.
  // When true the mic records a clip and POSTs it to /api/transcribe instead of
  // using the browser's built-in Web Speech API (which depends on Google's
  // speech service and is often blocked by Arc shields / content blockers).
  transcriptionAvailable?: boolean;
  // Seed the composer with a prompt (used by the welcome screen's suggestion
  // chips, which create a conversation then hand the user a ready-to-send
  // prompt). Only applied once per new value, so re-renders or the parent
  // clearing the prop never clobber something the user is already typing.
  initialText?: string;
}

const TEXT_ACCEPT =
  ".pdf,.txt,.md,.markdown,.csv,.tsv,.json,.yaml,.yml,.js,.mjs,.cjs,.ts,.tsx,.jsx,.py,.rb,.go,.rs,.java,.kt,.c,.cc,.cpp,.h,.hpp,.cs,.php,.swift,.sh,.bash,.sql,.html,.htm,.css,.scss,.toml,.ini,.env,.log,.xml";

// Largest dimension (px) we downscale an attached image to before storing and
// OCR. Phone screenshots/photos at 3000px+ make tesseract slow and bloat the
// stored data URL; ~1600px keeps text legible for OCR while cutting recognition
// time and DB size sharply. Photos become JPEG, screenshots stay PNG so text
// stays sharp.
const MAX_DIM = 1600;

function downscaleImage(file: File): Promise<{ blob: File; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas 2D context unavailable"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const isPng = file.type === "image/png";
      const type = isPng ? "image/png" : "image/jpeg";
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Canvas toBlob failed"));
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = typeof reader.result === "string" ? reader.result : "";
            if (!dataUrl) {
              reject(new Error("dataURL read failed"));
              return;
            }
            resolve({ blob: new File([blob], file.name, { type }), dataUrl });
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        },
        type,
        isPng ? undefined : 0.92,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image decode failed"));
    };
    img.src = url;
  });
}

export function ChatInput({ onSend, disabled, placeholder, streaming, onStop, projectId, transcriptionAvailable, initialText }: Props) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState<Array<{ id: string; attachment: Attachment; file?: File }>>([]);
  const [extracting, setExtracting] = useState(false);
  const [parsingImage, setParsingImage] = useState<Set<string>>(new Set());
  const [addedToProject, setAddedToProject] = useState<Set<string>>(new Set());
  const [addingToProject, setAddingToProject] = useState<string | null>(null);
  const [gateMsg, setGateMsg] = useState<string | null>(null);
  // Web-search toggle (default on). When armed, the server may attach the
  // web_search tool to the turn. Persisted across the conversation via the
  // parent's lastWebRef, so regenerate/edit reuse the last user choice.
  const [web, setWeb] = useState(true);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const voice = useVoiceTyping({ value, onValueChange: setValue, transcriptionAvailable });

  // Grow to fit content, capped at ~6 lines, then scroll.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [value]);

  // Seed the composer from `initialText` (welcome-screen suggestion chips).
  // The seededRef guard ensures we apply each prompt only once per distinct
  // value, so a re-render with the same prop — or the parent clearing it to
  // undefined after — never overwrites text the user is already editing.
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (initialText && initialText !== seededRef.current) {
      seededRef.current = initialText;
      setValue(initialText);
      ref.current?.focus();
    }
  }, [initialText]);

  // Add an image attachment. All models accept images: vision-capable models
  // Add an image attachment. All models accept images: vision-capable models
  // get the raw image part server-side; text-only models get the OCR'd text
  // inlined instead. We OCR here at attach time so the parsed text travels with
  // the persisted attachment and is reused on every turn (and survives a later
  // model switch) rather than re-parsing each turn. Images are downscaled
  // (module-scope downscaleImage) before storing/OCR — see MAX_DIM above.
  async function addImageFile(file: File) {
    const id = crypto.randomUUID();
    let stored: { blob: File; dataUrl: string };
    try {
      stored = await downscaleImage(file);
    } catch {
      // Downscale can fail on exotic formats; fall back to the original file.
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      }).catch(() => "");
      stored = { blob: file, dataUrl };
    }
    setPending((prev) => [
      ...prev,
      { id, attachment: { type: "image", name: file.name, mime: stored.blob.type, dataUrl: stored.dataUrl }, file: stored.blob },
    ]);
    await parseImage(id, stored.blob);
  }

  async function parseImage(id: string, file: File) {
    setParsingImage((prev) => new Set(prev).add(id));
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/parse-image", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { text?: string; charCount?: number };
      const text = typeof data.text === "string" ? data.text : "";
      const charCount = typeof data.charCount === "number" ? data.charCount : text.length;
      setPending((prev) =>
        prev.map((p) =>
          p.id === id && p.attachment.type === "image"
            ? { ...p, attachment: { ...p.attachment, text, charCount } }
            : p,
        ),
      );
    } finally {
      setParsingImage((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function addTextFile(file: File) {
    setExtracting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setGateMsg(err.error || "Could not read that file.");
        return;
      }
      const data = (await res.json()) as { name: string; text: string; charCount: number };
      setPending((prev) => [
        ...prev,
        { id: crypto.randomUUID(), attachment: { type: "file", name: data.name, text: data.text, charCount: data.charCount }, file },
      ]);
    } finally {
      setExtracting(false);
    }
  }

  function onPickChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files) {
      for (const f of Array.from(files)) {
        if (f.type.startsWith("image/")) addImageFile(f);
        else addTextFile(f);
      }
    }
    e.target.value = "";
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of Array.from(items)) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) {
          e.preventDefault();
          addImageFile(f);
        }
      }
    }
  }

  async function addToProject(id: string) {
    const item = pending.find((p) => p.id === id);
    if (!item || item.attachment.type !== "file" || !item.file || !projectId) return;
    setAddingToProject(id);
    try {
      const form = new FormData();
      form.append("projectId", projectId);
      form.append("file", item.file);
      const res = await fetch("/api/materials", { method: "POST", body: form });
      if (res.ok) {
        setAddedToProject((prev) => new Set(prev).add(id));
      } else {
        // /api/materials returns JSON errors { error: string }; fall back to a
        // status-coded message if the body isn't JSON (transport errors etc.).
        const err = await res.json().catch(() => ({}));
        const detail =
          (err && typeof err === "object" && "error" in err && typeof err.error === "string" && err.error) ||
          `Add to project failed (${res.status}).`;
        setGateMsg(detail);
      }
    } finally {
      setAddingToProject(null);
    }
  }

  function submit() {
    const text = value.trim();
    // Block send while an image is still being OCR'd: for a text-only model the
    // parsed text IS the image's content, so sending mid-parse would lose it.
    if ((!text && pending.length === 0) || disabled || streaming || parsingImage.size > 0) return;
    onSend(text, pending.map((p) => p.attachment), false, web);
    setValue("");
    setPending([]);
    setAddedToProject(new Set());
    setGateMsg(null);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form onSubmit={onSubmit} className="px-4 pb-4 pt-3 tab:px-6 tab:pb-5">
      {(gateMsg || voice.message) && (
        <div className="chat-composer-wrapper mono mb-1 text-[11px] text-danger">{gateMsg || voice.message}</div>
      )}
      <div className="chat-composer-wrapper rounded-panel border border-border bg-surface p-3 transition-[border-color,box-shadow,transform] duration-fast ease-out focus-within:-translate-y-px focus-within:border-border-strong focus-within:shadow-card">
        {pending.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pending.map((p) => (
              <div
                key={p.id}
                className="mono flex items-center gap-1.5 rounded-control border border-border bg-surface-2 px-2.5 py-1.5 text-[11px] text-content-muted"
              >
                {p.attachment.type === "image" ? (
                  <>
                    <img src={p.attachment.dataUrl} alt={p.attachment.name} className="h-7 w-7 rounded-md object-cover" />
                    <span className="max-w-[160px] truncate">
                      {parsingImage.has(p.id)
                        ? "parsing…"
                        : `OCR ${(p.attachment.charCount ?? 0).toLocaleString()}c`}
                    </span>
                  </>
                ) : (
                  <span className="flex max-w-[160px] items-center gap-1 truncate">
                    <Paperclip size={11} className="shrink-0" /> {p.attachment.name} ({p.attachment.charCount.toLocaleString()}c)
                  </span>
                )}
                {p.attachment.type === "file" && projectId && (
                  addedToProject.has(p.id) ? (
                    <span className="flex items-center gap-0.5 text-feynman">
                      <Check size={11} /> added
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => addToProject(p.id)}
                      disabled={addingToProject === p.id}
                      className="flex items-center gap-0.5 text-feynman hover:underline disabled:opacity-50"
                    >
                      <FolderPlus size={11} />
                      {addingToProject === p.id ? "…" : "to project"}
                    </button>
                  )
                )}
                <button
                  type="button"
                  onClick={() => setPending((prev) => prev.filter((x) => x.id !== p.id))}
                  aria-label="Remove attachment"
                  className="text-content-faint transition-colors hover:text-rule"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={`${TEXT_ACCEPT},image/*`}
            multiple
            className="hidden"
            onChange={onPickChange}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || extracting}
            title="Attach files or images (images are OCR'd so any model can read them)"
            aria-label="Attach files"
            className="shrink-0"
          >
            <Plus size={15} strokeWidth={2} />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setWeb((v) => !v)}
            disabled={disabled}
            aria-pressed={web}
            title="Toggle web search for this turn"
            className={cn("shrink-0", web && "border-rule text-rule hover:bg-rule/10")}
          >
            <Globe size={14} />
            web
          </Button>
          {(voice.speechSupported || transcriptionAvailable) && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={voice.toggleVoice}
              disabled={disabled || voice.transcribing}
              title={voice.transcribing ? "Transcribing…" : voice.listening ? "Stop voice typing" : "Voice type"}
              aria-label={voice.transcribing ? "Transcribing…" : voice.listening ? "Stop voice typing" : "Voice type"}
              className={cn(
                "shrink-0",
                voice.listening && "border-rule text-rule hover:bg-rule/10",
                voice.listening && "animate-pulse",
              )}
            >
              {voice.transcribing ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} />}
            </Button>
          )}
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            disabled={disabled}
            placeholder={placeholder || "Message Loom…"}
            className="max-h-48 flex-1 resize-none bg-transparent px-1 py-1.5 text-[13px] leading-6 text-ink outline-none placeholder:text-content-faint disabled:opacity-50"
          />
          {streaming ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onStop}
              aria-label="Stop generating"
              className="shrink-0 border-rule bg-rule/5 text-rule hover:bg-rule/10"
              title="Stop (Esc)"
            >
              <Square size={13} className="fill-current" />
              stop
            </Button>
          ) : (
            <Button
              type="submit"
              variant="accent"
              size="sm"
              disabled={disabled || (!value.trim() && pending.length === 0) || parsingImage.size > 0}
              aria-label="Send"
              className="shrink-0"
            >
              <ArrowUp size={15} strokeWidth={2.25} />
              send
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
