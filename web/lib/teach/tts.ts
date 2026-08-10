"use client";

import { performer } from "./performer";
import {
  EXPRESSION_PROFILES,
  inferSpeechExpression,
  type SpeechExpressionCue,
} from "./expression";

// The teacher's voice: Kokoro TTS via /api/tts, with the browser's
// speechSynthesis as the fallback when the Kokoro host is unreachable.
//
// Segments are synthesized ahead of time (the whole lesson plan is known
// before the performance starts), so playback begins instantly instead of
// waiting ~1.5s per sentence. Pausing pauses the audio element mid-word and
// resume continues from the same spot — no re-speaking.

const cache = new Map<string, Promise<string>>(); // text -> object URL
let voice: string | null = null;
let kokoroUp: boolean | null = null; // null = not probed yet
let current: HTMLAudioElement | null = null;

export function setVoice(v: string): void {
  if (v !== voice) {
    voice = v;
    cache.clear(); // cached audio belongs to the old voice
  }
}

export function getVoice(): string | null {
  return voice;
}

export async function probeTts(): Promise<{ available: boolean; voices: string[] }> {
  try {
    const res = await fetch("/api/tts");
    const data = (await res.json()) as { available: boolean; voice?: string; voices: string[] };
    kokoroUp = data.available;
    if (data.available && !voice && data.voice) voice = data.voice;
    return data;
  } catch {
    kokoroUp = false;
    return { available: false, voices: [] };
  }
}

function synth(text: string, cue: SpeechExpressionCue = inferSpeechExpression(text)): Promise<string> {
  const key = `${voice ?? "default"}|${cue.expression}|${cue.rate}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voice: voice ?? undefined,
        expression: cue.expression,
        rate: cue.rate,
      }),
    });
    if (!res.ok) throw new Error(`tts ${res.status}`);
    return URL.createObjectURL(await res.blob());
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

export function prefetchSpeech(text: string): void {
  if (kokoroUp === false || !text.trim()) return;
  void synth(text, inferSpeechExpression(text)).catch(() => {});
}

// Browser voice — used when Kokoro is down. Cancelled by a pause, so the
// caller re-speaks the segment on resume (speechSynthesis can't resume
// reliably across browsers).
function speakFallback(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const synthApi = window.speechSynthesis;
    if (!synthApi) return resolve(true);
    const cue = inferSpeechExpression(text);
    const profile = EXPRESSION_PROFILES[cue.expression];
    const u = new SpeechSynthesisUtterance(text);
    u.rate = cue.rate;
    u.volume = Math.max(0, Math.min(1, profile.volume));
    u.pitch = cue.expression === "curious" ? 1.06 : cue.expression === "serious" ? 0.96 : 1;
    u.onend = () => resolve(!performer.paused());
    u.onerror = () => resolve(!performer.paused());
    synthApi.speak(u);
  });
}

/**
 * Speak one segment. Resolves true when it finished, false when it was
 * interrupted before finishing and should be retried by the caller.
 * Honours performer.pause()/resume() while playing.
 */
export async function speak(text: string, muted: boolean): Promise<boolean> {
  const clean = text.trim();
  if (!clean || muted) return true;
  if (kokoroUp === null) await probeTts();
  if (kokoroUp === false) return speakFallback(clean);

  let url: string;
  try {
    url = await synth(clean, inferSpeechExpression(clean));
  } catch {
    kokoroUp = false; // host went away mid-lesson
    return speakFallback(clean);
  }

  const audio = new Audio(url);
  current = audio;
  // Poll the performer: pause halts the audio in place, resume continues it.
  const watch = setInterval(() => {
    if (performer.paused()) {
      if (!audio.paused) audio.pause();
    } else if (audio.paused && !audio.ended && current === audio) {
      void audio.play().catch(() => {});
    }
  }, 120);

  try {
    await audio.play().catch(() => {});
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      // Cancelled (new lesson / stop) — bail out of the wait.
      const cancelWatch = setInterval(() => {
        if (current !== audio) {
          clearInterval(cancelWatch);
          resolve();
        }
      }, 120);
      audio.addEventListener("ended", () => clearInterval(cancelWatch), { once: true });
    });
  } finally {
    clearInterval(watch);
    if (current === audio) current = null;
  }
  // Interrupted before the end → the caller replays this segment.
  return audio.ended || current !== audio ? true : !performer.paused();
}

export function cancelSpeech(): void {
  if (current) {
    current.pause();
    current = null;
  }
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* SSR */
  }
}
