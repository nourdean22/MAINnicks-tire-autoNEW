"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";

// hooks-lib REST→tRPC slice (2026-05-22) · the FINAL slice.
// `/api/ai/transcribe` takes a multipart `FormData` audio Blob — tRPC's
// httpBatchLink JSON-serialises its inputs, so a Blob cannot ride a
// tRPC procedure. This is the same carve-out the prior slice made for
// the voice/token mint ("stays plain fetch · no procedure"). The
// `authedFetch` import is replaced with a bare `fetch` carrying
// `credentials: "include"` (the only thing `authedFetch` added over
// `fetch` for a transient best-effort call like this) — the
// `use-authed-fetch` import is gone.
/**
 * 2026-07-12 · Pick a MediaRecorder container the browser actually supports.
 * The mic looked "unavailable" on the iOS PWA because the code hardcoded
 * `mimeType: "audio/webm"` — WebKit does NOT support webm recording, so the
 * MediaRecorder constructor threw NotSupportedError, which the bare catch
 * misreported as a permission error. Desktop Chrome keeps webm; iOS lands on
 * audio/mp4. Returns "" when none is explicitly supported (let the browser
 * pick its own default rather than throw).
 */
function pickAudioMime(): string {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/aac",
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

/** Upload filename extension must match the real container or Whisper 400s
 *  on format sniff. */
function extForMime(mime: string): string {
  if (mime.includes("mp4") || mime.includes("aac")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

/**
 * useVoiceInput — single recording + continuous voice mode.
 * Single: tap to record, tap to stop, transcribes via Whisper.
 * Continuous: auto-sends on 2s silence, restarts recording.
 */
export function useVoiceInput(onTranscript: (text: string) => void, onAutoSend: (text: string) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [continuous, setContinuous] = useState(false);
  // Apr 27 · audioLevel · 0-1 scale, updated ~every animation frame
  // while recording. The input row's waveform bars subscribe to this
  // so they bounce to Nour's actual voice instead of a fake animation.
  const [audioLevel, setAudioLevel] = useState(0);
  const continuousRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const levelRafRef = useRef<number | null>(null);
  // Continuous-mode silence-detection RAF handle — stored so stopContinuous
  // can cancel the loop. Without it, a rapid stop→start leaves the old
  // loop running (it re-sees continuousRef=true) and a second loop is
  // started → two RAF loops compounding on every toggle.
  const silenceRafRef = useRef<number | null>(null);

  // ── Single recording ──
  const startRecording = useCallback(async () => {
    // 2026-07-12 · getUserMedia in its OWN try so ONLY a real permission /
    // secure-context rejection shows "Microphone unavailable". A codec/
    // MediaRecorder failure below is a different error and must not be
    // misreported as a permission problem.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Microphone unavailable — check permissions");
      return;
    }
    try {
      // Apr 27 · also wire the analyser for single recordings so the
      // waveform-bars UI bounces during tap-to-record (was only set
      // up for continuous mode before).
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(data);
        // Average the lower-freq bins (vocal range), normalize 0-1.
        let sum = 0;
        const bins = Math.min(data.length, 32);
        for (let i = 0; i < bins; i++) sum += data[i];
        const avg = sum / bins / 255;
        // Easing — cube to make small ambient noise less jumpy.
        setAudioLevel(Math.min(1, avg * 1.8));
        levelRafRef.current = requestAnimationFrame(tick);
      };
      levelRafRef.current = requestAnimationFrame(tick);

      // Pick a supported container (iOS rejects webm → NotSupportedError).
      const mime = pickAudioMime();
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      const recMime = recorder.mimeType || mime || "audio/webm";
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (levelRafRef.current) { cancelAnimationFrame(levelRafRef.current); levelRafRef.current = null; }
        if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
        analyserRef.current = null;
        setAudioLevel(0);
        const blob = new Blob(audioChunksRef.current, { type: recMime });
        if (blob.size < 1000) return;
        setTranscribing(true);
        try {
          const form = new FormData();
          form.append("audio", blob, `voice.${extForMime(recMime)}`);
          const res = await fetch("/api/ai/transcribe", { method: "POST", body: form, credentials: "include" });
          if (!res.ok) {
            // v10.0.420 · was silently swallowed · the 7-day audit caught
            // /api/ai/transcribe returning 404 forever (route never built).
            // Now we surface the failure so operator knows mic ≠ stream.
            console.warn(`[voice-input] transcribe HTTP ${res.status}`);
            // forensic-audit MEDIUM · surface via toast, not just console —
            // there is no console on the standalone iOS PWA, so the utterance
            // used to vanish with zero feedback and the mic looked dead.
            toast.error("Voice transcription failed — try again");
            return;
          }
          const data = await res.json();
          if (data.text) {
            onTranscript(data.text);
          } else if (data.error) {
            console.warn(`[voice-input] transcribe error: ${data.error}`);
            toast.error("Voice transcription failed — try again");
          }
        } catch (err) {
          console.warn(`[voice-input] transcribe request failed:`, err);
          toast.error("Voice transcription failed — check your connection");
        } finally {
          setTranscribing(false);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      // getUserMedia already succeeded above, so this is a recorder/codec
      // failure, NOT a permission problem — don't misreport it as one. Release
      // the mic we acquired and surface an honest message.
      stream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
      if (levelRafRef.current) { cancelAnimationFrame(levelRafRef.current); levelRafRef.current = null; }
      if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
      analyserRef.current = null;
      setAudioLevel(0);
      console.warn("[voice-input] recorder init failed:", err);
      toast.error("Couldn't start recording on this device — try again");
    }
  }, [onTranscript]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (levelRafRef.current) { cancelAnimationFrame(levelRafRef.current); levelRafRef.current = null; }
    setAudioLevel(0);
    setIsRecording(false);
  }, []);

  // ── Continuous voice ──
  const startContinuous = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;

      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (blob.size < 1000) {
          if (continuousRef.current) { audioChunksRef.current = []; recorder.start(); }
          return;
        }
        setTranscribing(true);
        try {
          const form = new FormData();
          form.append("audio", blob, "voice.webm");
          const res = await fetch("/api/ai/transcribe", { method: "POST", body: form, credentials: "include" });
          if (!res.ok) {
            console.warn(`[voice-input · continuous] transcribe HTTP ${res.status}`);
          } else {
            const data = await res.json();
            if (data.text) onAutoSend(data.text);
            else if (data.error) console.warn(`[voice-input · continuous] ${data.error}`);
          }
        } catch (err) {
          console.warn(`[voice-input · continuous] transcribe request failed:`, err);
        } finally {
          setTranscribing(false);
        }

        if (continuousRef.current) {
          audioChunksRef.current = [];
          try { recorder.start(); } catch {}
        }
      };

      // Silence detection — also publishes audioLevel for the UI
      // waveform. Reading byte freq data once per frame is cheap.
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      function checkSilence() {
        if (!continuousRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((s, v) => s + v, 0) / dataArray.length;
        // Publish normalized level for UI (0-1)
        setAudioLevel(Math.min(1, (avg / 255) * 1.8));

        if (avg < 10) {
          if (!silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              if (recorder.state === "recording") recorder.stop();
              silenceTimerRef.current = null;
            }, 2000);
          }
        } else {
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        }
        silenceRafRef.current = requestAnimationFrame(checkSilence);
      }

      recorder.start();
      mediaRecorderRef.current = recorder;
      continuousRef.current = true;
      setContinuous(true);
      setIsRecording(true);
      checkSilence();
    } catch {
      // Mic access denied
    }
  }, [onAutoSend]);

  const stopContinuous = useCallback(() => {
    continuousRef.current = false;
    setContinuous(false);
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (silenceRafRef.current) { cancelAnimationFrame(silenceRafRef.current); silenceRafRef.current = null; }
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    setAudioLevel(0);
    setIsRecording(false);
  }, []);

  useEffect(() => {
    return () => {
      continuousRef.current = false;
      if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current);
      if (silenceRafRef.current) cancelAnimationFrame(silenceRafRef.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      try { mediaRecorderRef.current?.stop(); } catch {}
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  return {
    isRecording,
    transcribing,
    continuous,
    audioLevel,
    startRecording,
    stopRecording,
    startContinuous,
    stopContinuous,
    mediaRecorderRef,
  };
}
