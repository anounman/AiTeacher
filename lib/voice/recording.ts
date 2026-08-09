// MediaRecorder output differs by browser: Chromium normally produces WebM,
// while Safari/iPadOS commonly produces MPEG-4 audio. Pick a supported format
// at runtime and give the transcription upload a matching extension.
export const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm",
] as const;

export function preferredRecorderMimeType(
  isSupported: (mimeType: string) => boolean,
): string {
  return RECORDER_MIME_CANDIDATES.find(isSupported) ?? "";
}

export function audioUploadName(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("mp4") || normalized.includes("m4a")) return "speech.m4a";
  if (normalized.includes("wav")) return "speech.wav";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "speech.mp3";
  return "speech.webm";
}

export function microphoneErrorMessage(error: unknown): string {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";

  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone blocked. On iPad, allow Microphone for this site in Safari settings, then try again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone was found on this device.";
  }
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") {
    return "The microphone is busy in another app. Close that app and try again.";
  }
  return "Could not start the microphone. Check Safari's microphone permission and try again.";
}
