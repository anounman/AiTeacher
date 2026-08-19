"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Options = {
  value: string;
  onValueChange: (value: string) => void;
  transcriptionAvailable?: boolean;
};

export function useVoiceTyping({ value, onValueChange, transcriptionAvailable = false }: Options) {
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const baseRef = useRef("");
  const manualStopRef = useRef(false);
  const retriedRef = useRef(false);
  const errorRef = useRef(false);
  const gotResultRef = useRef(false);
  const startedAtRef = useRef(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpeechSupported(typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition));
  }, []);

  const stopMicTracks = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
  }, []);

  const transcribe = useCallback(async (blob: Blob) => {
    setListening(false);
    setTranscribing(true);
    setMessage("transcribing…");
    try {
      const form = new FormData();
      form.append("audio", blob, "audio.webm");
      const response = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!response.ok || (!data.text && data.error)) {
        setMessage(data.error || `Transcription failed (${response.status}).`);
      } else if (data.text) {
        const prefix = baseRef.current;
        onValueChange(prefix + (prefix && !prefix.endsWith(" ") ? " " : "") + data.text);
        setMessage(null);
      } else {
        setMessage("Didn't catch anything — try again.");
      }
    } catch {
      setMessage("Could not reach the transcription service.");
    } finally {
      setTranscribing(false);
    }
  }, [onValueChange]);

  const startRecording = useCallback(async () => {
    setMessage(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setMessage("Microphone blocked — allow access in your browser site settings.");
      return;
    }
    micStreamRef.current = stream;
    chunksRef.current = [];
    baseRef.current = value;
    const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
      stopMicTracks();
      chunksRef.current = [];
      if (blob.size === 0) {
        setListening(false);
        setMessage("Didn't catch anything — try again.");
        return;
      }
      void transcribe(blob);
    };
    recorder.onerror = () => {
      stopMicTracks();
      setListening(false);
      setMessage("Recording failed — try again.");
    };
    mediaRecorderRef.current = recorder;
    setListening(true);
    recorder.start();
  }, [stopMicTracks, transcribe, value]);

  const startRecognition = useCallback(() => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    manualStopRef.current = false;
    retriedRef.current = false;
    errorRef.current = false;
    gotResultRef.current = false;
    setMessage(null);
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    baseRef.current = value;
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      gotResultRef.current = true;
      let final = "";
      let interim = "";
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index];
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }
      onValueChange(baseRef.current + final + interim);
    };
    recognition.onerror = (event) => {
      errorRef.current = true;
      const errors: Record<string, string> = {
        "not-allowed": "Microphone blocked — allow access in your browser site settings.",
        "service-not-allowed": "Microphone blocked — allow access in your browser site settings.",
        "no-speech": "Didn't catch that — try again.",
        "audio-capture": "No microphone found.",
        network: "Voice needs a network connection to the speech service — disable any blocker for this site and try again.",
      };
      if (event.error !== "aborted") setMessage(errors[event.error] || `Voice error: ${event.error}`);
      setListening(false);
    };
    recognition.onend = () => {
      if (manualStopRef.current || errorRef.current) {
        setListening(false);
        return;
      }
      const instantFail = !gotResultRef.current && startedAtRef.current > 0 && Date.now() - startedAtRef.current < 1500;
      if (instantFail && retriedRef.current) {
        setListening(false);
        setMessage("Voice stopped before recognizing anything — check mic permission and your connection, then try again.");
        return;
      }
      retriedRef.current = true;
      gotResultRef.current = false;
      startedAtRef.current = Date.now();
      try {
        recognition.start();
      } catch {
        setListening(false);
      }
    };
    recognitionRef.current = recognition;
    setListening(true);
    startedAtRef.current = Date.now();
    try {
      recognition.start();
    } catch {
      setListening(false);
      setMessage("Couldn't start voice typing — try again.");
    }
  }, [onValueChange, value]);

  const toggleVoice = useCallback(async () => {
    if (!speechSupported && !transcriptionAvailable) return;
    if (listening || transcribing) {
      if (transcriptionAvailable) {
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state !== "inactive") recorder.stop();
        else stopMicTracks();
      } else {
        manualStopRef.current = true;
        recognitionRef.current?.stop();
      }
      return;
    }
    if (transcriptionAvailable) await startRecording();
    else startRecognition();
  }, [listening, speechSupported, startRecognition, startRecording, stopMicTracks, transcribing, transcriptionAvailable]);

  useEffect(() => () => {
    manualStopRef.current = true;
    recognitionRef.current?.abort();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    stopMicTracks();
  }, [stopMicTracks]);

  return { speechSupported, listening, transcribing, message, toggleVoice };
}
