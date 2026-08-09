"use client";

import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent, type ClipboardEvent } from "react";
import type { Attachment } from "@/lib/db/schema";
import {
  audioUploadName,
  microphoneErrorMessage,
  preferredRecorderMimeType,
} from "@/lib/voice/recording";

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
  const [listening, setListening] = useState(false);
  // Armed for the next send → the message becomes a one-shot authored
  // document (document-authoring prompt + kind='document' + a document card
  // with a Print/Save-as-PDF action). Resets after sending so follow-ups are
  // normal chat replies unless re-armed.
  const [docMode, setDocMode] = useState(false);
  // Web-search toggle (default on). When armed, the server may attach the
  // web_search tool to the turn. Persisted across the conversation via the
  // parent's lastWebRef, so regenerate/edit reuse the last user choice.
  const [web, setWeb] = useState(true);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const baseRef = useRef("");
  // MediaRecorder voice path (used when an OpenAI transcription key is
  // configured). Holds the active recorder, the mic stream (to stop its
  // tracks on stop), the accumulated chunks, and the composer text captured
  // at record-start so the transcript appends to what's already there.
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recBaseRef = useRef("");
  const [transcribing, setTranscribing] = useState(false);
  // Voice typing re-arm guards. `manualStopRef` distinguishes a user click-stop
  // from an engine auto-stop; `retriedRef` caps re-arm to one attempt so a
  // persistently-failing engine can't loop; `errorRef` blocks re-arm after an
  // onerror (so a permission denial doesn't spin).
  const manualStopRef = useRef(false);
  const retriedRef = useRef(false);
  const errorRef = useRef(false);
  // True once this recognition session has returned any result; lets onend
  // tell a recoverable pause (got speech, restart) from an instant die (no
  // speech, give up). startedAtRef timestamps each (re)start for the
  // rapid-fail guard.
  const gotResultRef = useRef(false);
  const startedAtRef = useRef(0);
  // Start false so the server and the client's first render agree (no mic
  // button), then detect Web Speech support after mount. Computing this during
  // render would be false on the server and true on the client → hydration
  // mismatch on the mic button.
  const [micCapabilities, setMicCapabilities] = useState({
    checked: false,
    secure: true,
    speech: false,
    recording: false,
  });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMicCapabilities({
      checked: true,
      secure: window.isSecureContext,
      speech: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
      recording:
        !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined",
    });
  }, []);

  useEffect(() => () => {
    manualStopRef.current = true;
    recognitionRef.current?.stop();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

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
    onSend(text, pending.map((p) => p.attachment), docMode, web);
    setValue("");
    setPending([]);
    setAddedToProject(new Set());
    setGateMsg(null);
    setDocMode(false);
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

  // Mic button entry point. Branches on whether an OpenAI transcription key
  // is configured: record-and-transcribe (works behind blockers, no Google)
  // vs. the browser's built-in Web Speech API (live interim, but depends on
  // Google's speech service and a blocker-free path).
  async function toggleVoice() {
    if (!micCapabilities.secure) {
      setGateMsg("Microphone access needs HTTPS on iPad. Open the secure .ts.net Tailscale link, not the http:// IP address.");
      return;
    }
    const recorderAvailable = !!transcriptionAvailable && micCapabilities.recording;
    if (!micCapabilities.speech && !recorderAvailable) {
      setGateMsg("Voice typing is not available in this browser. Open this page in Safari, or configure transcription in Settings.");
      return;
    }
    if (listening || transcribing) {
      if (mediaRecorderRef.current?.state && mediaRecorderRef.current.state !== "inactive") stopRecording();
      else {
        manualStopRef.current = true;
        recognitionRef.current?.stop();
      }
      return;
    }
    if (recorderAvailable) await startRecording();
    else startRecognition();
  }

  // --- Browser-native Web Speech path (fallback when no OpenAI key) -------
  function startRecognition() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;
    // Clear guards + any stale gate message at the start of each new start.
    manualStopRef.current = false;
    retriedRef.current = false;
    errorRef.current = false;
    gotResultRef.current = false;
    setGateMsg(null);

    // NOTE: no `await` before rec.start(). Chromium's Web Speech recognition
    // must start within the user-gesture call stack; awaiting anything (e.g.
    // navigator.permissions.query) first can drop transient activation and
    // make start() fail instantly. The onerror handler below already covers a
    // denied mic with a message, so the pre-check isn't worth the risk.

    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    baseRef.current = value;
    rec.onresult = (e: SpeechRecognitionEvent) => {
      gotResultRef.current = true;
      let final = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      setValue(baseRef.current + final + interim);
    };
    rec.onerror = (e) => {
      errorRef.current = true;
      const err = e.error;
      if (err === "not-allowed" || err === "service-not-allowed") {
        setGateMsg("Microphone blocked. On iPad, allow Microphone for this site in Safari settings, then try again.");
      } else if (err === "no-speech") {
        setGateMsg("Didn't catch that — try again.");
      } else if (err === "audio-capture") {
        setGateMsg("No microphone found.");
      } else if (err === "network") {
        // Chromium sends audio to a remote speech service; a blocker (Arc /
        // Brave shields, ad/tracker extensions, or offline) makes it fail
        // instantly. This is the most common "flashes then off, no message".
        setGateMsg("Voice needs a network connection to the speech service — disable any blocker for this site and try again.");
      } else if (err === "aborted") {
        // System/user abort — no message.
      } else {
        // Never swallow an unknown error silently — surface the code so it's
        // diagnosable instead of "doesn't work" with no feedback.
        setGateMsg(`Voice error: ${err}`);
      }
      setListening(false);
    };
    rec.onend = () => {
      // Survive the brief auto-stops that `continuous = true` doesn't fully
      // prevent in some engines. Re-arm if the stop wasn't user/error
      // initiated, but bail (with a message) if it dies instantly without
      // ever recognizing anything twice in a row — that's a persistent
      // failure, not a recoverable pause, and looping would spin forever.
      if (manualStopRef.current || errorRef.current) {
        setListening(false);
        return;
      }
      const instantFail =
        !gotResultRef.current && startedAtRef.current > 0 && Date.now() - startedAtRef.current < 1500;
      if (instantFail && retriedRef.current) {
        setListening(false);
        setGateMsg("Voice stopped before recognizing anything — check mic permission and your connection, then try again.");
        return;
      }
      retriedRef.current = true;
      gotResultRef.current = false;
      startedAtRef.current = Date.now();
      try {
        rec.start();
      } catch {
        setListening(false);
      }
    };
    recognitionRef.current = rec;
    // Reflect intent immediately; the gateMsg surfaces above the input if
    // start() bails below.
    setListening(true);
    startedAtRef.current = Date.now();
    try {
      rec.start();
    } catch {
      setListening(false);
      setGateMsg("Couldn't start voice typing — try again.");
    }
  }

  // --- OpenAI Whisper path (record a clip, transcribe server-side) -------
  // getUserMedia must run in the user-gesture stack — toggleVoice calls this
  // directly with no prior await, so activation is intact.
  async function startRecording() {
    setGateMsg(null);
    if (!window.isSecureContext) {
      setGateMsg("Microphone access needs HTTPS on iPad. Open the secure .ts.net Tailscale link, not the http:// IP address.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setGateMsg("This browser cannot record audio. Open the secure link in Safari and try again.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch (cause) {
      setGateMsg(microphoneErrorMessage(cause));
      return;
    }
    micStreamRef.current = stream;
    chunksRef.current = [];
    recBaseRef.current = value;
    // Chromium commonly gives WebM; Safari/iPadOS commonly gives MP4 audio.
    const mime = preferredRecorderMimeType((candidate) => MediaRecorder.isTypeSupported(candidate));
    let recorder: MediaRecorder;
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (cause) {
      stopMicTracks();
      setGateMsg(microphoneErrorMessage(cause));
      return;
    }
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const actualMime = recorder.mimeType || chunksRef.current[0]?.type || mime || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: actualMime });
      // Stop the mic tracks regardless of outcome so the indicator clears.
      stopMicTracks();
      mediaRecorderRef.current = null;
      chunksRef.current = [];
      if (blob.size === 0) {
        setListening(false);
        setGateMsg("Didn't catch anything — try again.");
        return;
      }
      void transcribe(blob, audioUploadName(actualMime));
    };
    recorder.onerror = () => {
      stopMicTracks();
      setListening(false);
      setGateMsg("Recording failed — try again.");
    };
    mediaRecorderRef.current = recorder;
    setListening(true);
    recorder.start();
  }

  function stopRecording() {
    const r = mediaRecorderRef.current;
    if (r && r.state !== "inactive") r.stop(); // fires onstop → transcribe
    else stopMicTracks();
  }

  function stopMicTracks() {
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
  }

  async function transcribe(blob: Blob, filename: string) {
    setListening(false);
    setTranscribing(true);
    setGateMsg("transcribing…");
    try {
      const form = new FormData();
      form.append("audio", blob, filename);
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || (!data.text && data.error)) {
        setGateMsg(data.error || `Transcription failed (${res.status}).`);
      } else if (data.text) {
        // Append the transcript to the existing composer text (with a space
        // separator when both sides are non-empty) and clear any message.
        const prefix = recBaseRef.current;
        const sep = prefix && !prefix.endsWith(" ") ? " " : "";
        setValue(prefix + sep + data.text);
        setGateMsg(null);
      } else {
        setGateMsg("Didn't catch that — try again.");
      }
    } catch {
      setGateMsg("Could not reach the transcription service.");
    } finally {
      setTranscribing(false);
    }
  }

  const recorderAvailable = !!transcriptionAvailable && micCapabilities.recording;
  const voiceReady = micCapabilities.secure && (micCapabilities.speech || recorderAvailable);

  return (
    <form onSubmit={onSubmit} className="app-chat-input px-4 pb-5 pt-2">
      {gateMsg && (
        <div id="composer-status" role="status" className="mx-auto mb-1 max-w-3xl text-[11px] text-rule">{gateMsg}</div>
      )}
      <div className="mx-auto max-w-3xl rounded-[3px] border border-line bg-paper-2 px-3 py-2 transition-colors focus-within:border-ink/40">
        {pending.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pending.map((p) => (
              <div
                key={p.id}
                className="mono flex items-center gap-1.5 rounded-[2px] border border-line bg-paper px-2 py-1 text-[11px] text-ink-2"
              >
                {p.attachment.type === "image" ? (
                  <>
                    <img src={p.attachment.dataUrl} alt={p.attachment.name} className="h-7 w-7 rounded-[2px] object-cover" />
                    <span className="truncate max-w-[160px]">
                      {parsingImage.has(p.id)
                        ? "parsing…"
                        : `OCR ${(p.attachment.charCount ?? 0).toLocaleString()}c`}
                    </span>
                  </>
                ) : (
                  <span className="truncate max-w-[160px]">📎 {p.attachment.name} ({p.attachment.charCount.toLocaleString()}c)</span>
                )}
                {p.attachment.type === "file" && projectId && (
                  addedToProject.has(p.id) ? (
                    <span className="text-feynman">added ✓</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => addToProject(p.id)}
                      disabled={addingToProject === p.id}
                      className="text-feynman hover:underline disabled:opacity-50"
                    >
                      {addingToProject === p.id ? "…" : "＋ to project"}
                    </button>
                  )
                )}
                <button
                  type="button"
                  onClick={() => setPending((prev) => prev.filter((x) => x.id !== p.id))}
                  aria-label="Remove attachment"
                  className="text-ink-3 hover:text-rule"
                >
                  ×
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
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || extracting}
            title="Attach files or images (images are OCR'd so any model can read them)"
            aria-label="Attach files"
            className="mono shrink-0 rounded-[3px] border border-line bg-paper px-2 py-1.5 text-[12px] tracking-wide text-ink-2 transition-colors hover:border-ink/40 disabled:opacity-40"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setDocMode((v) => !v)}
            disabled={disabled}
            aria-pressed={docMode}
            title="Send this message as a formatted document you can print to PDF"
            className={`mono shrink-0 rounded-[3px] border px-2 py-1.5 text-[12px] tracking-wide transition-colors disabled:opacity-40 ${
              docMode
                ? "border-rule text-rule hover:bg-rule/10"
                : "border-line bg-paper text-ink-2 hover:border-ink/40"
            }`}
          >
            doc
          </button>
          <button
            type="button"
            onClick={() => setWeb((v) => !v)}
            disabled={disabled}
            aria-pressed={web}
            title="Toggle web search for this turn"
            className={`mono shrink-0 rounded-[3px] border px-2 py-1.5 text-[12px] tracking-wide transition-colors disabled:opacity-40 ${
              web
                ? "border-rule text-rule hover:bg-rule/10"
                : "border-line bg-paper text-ink-2 hover:border-ink/40"
            }`}
          >
            web
          </button>
          <button
            type="button"
            onClick={toggleVoice}
            disabled={disabled || transcribing || !micCapabilities.checked}
            title={
              transcribing
                ? "Transcribing…"
                : listening
                  ? "Stop voice typing"
                  : voiceReady
                    ? "Voice type"
                    : !micCapabilities.secure
                      ? "Microphone needs the secure HTTPS link"
                      : "Voice typing unavailable in this browser"
            }
            aria-label={
              transcribing
                ? "Transcribing…"
                : listening
                  ? "Stop voice typing"
                  : "Voice type"
            }
            aria-describedby={gateMsg ? "composer-status" : undefined}
            className={`mono shrink-0 rounded-[3px] border px-2 py-1.5 text-[12px] tracking-wide transition-colors disabled:opacity-40 ${
              listening
                ? "border-rule text-rule hover:bg-rule/10"
                : voiceReady
                  ? "border-line bg-paper text-ink-2 hover:border-ink/40"
                  : "border-rule/50 bg-paper text-rule"
            }`}
          >
            {listening ? "●" : "🎙"}
          </button>
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            disabled={disabled}
            placeholder={placeholder || "Ask about a concept…"}
            className="mono max-h-48 flex-1 resize-none bg-transparent py-1 text-[13px] leading-6 text-ink outline-none placeholder:text-ink-3 disabled:opacity-50"
          />
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="mono shrink-0 rounded-[3px] border border-rule px-3 py-1.5 text-[12px] tracking-wide text-rule transition-colors hover:bg-rule/10"
            >
              stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={disabled || (!value.trim() && pending.length === 0) || parsingImage.size > 0}
              aria-label="Send"
              className="mono shrink-0 rounded-[3px] bg-ink px-3 py-1.5 text-[12px] tracking-wide text-paper-2 transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              {docMode ? "send doc ↵" : "send ↵"}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
