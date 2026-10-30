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

interface BrowserSpeech {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

/**
 * 2026-10-30 · browser speech typing: free, no server key. Every server STT lane was down in prod
 * (OpenAI 401, HF 402, no GROQ_API_KEY), so desktop/Android dictation goes here first. Off on iOS:
 * a home-screen web app detects webkitSpeechRecognition but it never returns text.
 */
function browserSpeech(): (new () => BrowserSpeech) | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)) return null;
  const w = window as unknown as { SpeechRecognition?: new () => BrowserSpeech; webkitSpeechRecognition?: new () => BrowserSpeech };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** 502 = every configured server STT lane failed (app/api/ai/transcribe). */
function toastTranscribeFailure(status: number) {
  toast.error(
    status === 502
      ? "Voice typing is down: no speech service answered. A free Groq key (GROQ_API_KEY) fixes it."
      : "Voice transcription failed — try again",
    { id: "stt-failed" },
  );
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
  const speechRef = useRef<BrowserSpeech | null>(null);
  // A start waiting on the iOS mic prompt: a second tap must not open a second recorder, and a stop
  // during the wait must cancel it (second reader, 2026-10-30).
  const startingRef = useRef(false);
  const cancelStartRef = useRef(false);

  // ── Single recording ── resolves true when something is recording
  const startRecording = useCallback(async (): Promise<boolean> => {
    if (startingRef.current || speechRef.current || mediaRecorderRef.current?.state === "recording") return false;
    cancelStartRef.current = false;
    const Speech = browserSpeech();
    if (Speech) {
      const rec = new Speech();
      rec.lang = navigator.language || "en-US";
      rec.interimResults = false;
      rec.continuous = true;
      const finals: string[] = [];
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) finals.push(e.results[i][0].transcript);
        }
      };
      let heardNothing = false;
      rec.onerror = (e) => {
        if (e.error === "no-speech") heardNothing = true;
        else if (e.error === "not-allowed") toast.error("Microphone unavailable. Check permissions");
        else if (e.error === "service-not-allowed") toast.error("Speech recognition is turned off in this browser");
        else if (e.error === "network") toast.error("This browser's speech service is unreachable");
        else if (e.error !== "aborted") toast.error(`Voice typing stopped (${e.error}). Try again`);
      };
      rec.onend = () => {
        speechRef.current = null;
        setIsRecording(false);
        const text = finals.join(" ").trim();
        if (text) onTranscript(text);
        else if (heardNothing) toast("Didn't catch anything. Try again", { id: "stt-nothing" });
      };
      try {
        rec.start();
        speechRef.current = rec;
        setIsRecording(true);
        return true;
      } catch (err) {
        // Falls through to the recorder + server lane below.
        console.warn("[voice-input] browser speech start failed:", err);
      }
    }
    // 2026-07-12 · getUserMedia in its OWN try so ONLY a real permission /
    // secure-context rejection shows "Microphone unavailable". A codec/
    // MediaRecorder failure below is a different error and must not be
    // misreported as a permission problem.
    let stream: MediaStream;
    startingRef.current = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Microphone unavailable — check permissions");
      return false;
    } finally {
      startingRef.current = false;
    }
    if (cancelStartRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
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
            toastTranscribeFailure(res.status);
            return;
          }
          // 2026-08-27 · engine honesty (same contract as TTS): the route
          // names the lane that ACTUALLY transcribed and whether an
          // earlier configured lane failed first. Degradation is loud.
          // Deduped by id so rapid retries do not stack toasts.
          const data = await res.json();
          if (data.degraded && data.source) {
            toast.warning(`Transcribed via backup lane (${data.source})`, {
              id: "stt-degraded",
              duration: 3500,
            });
          }
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
      return true;
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
      return false;
    }
  }, [onTranscript]);

  const stopRecording = useCallback(() => {
    if (startingRef.current) cancelStartRef.current = true;
    if (speechRef.current) {
      speechRef.current.stop(); // onend delivers the text and clears isRecording
      return;
    }
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

      // 2026-10-30 · was hardcoded webm, which iOS cannot record (same fix as startRecording).
      const mime = pickAudioMime();
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      const recMime = recorder.mimeType || mime || "audio/webm";
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: recMime });
        if (blob.size < 1000) {
          if (continuousRef.current) { audioChunksRef.current = []; recorder.start(); }
          return;
        }
        setTranscribing(true);
        try {
          const form = new FormData();
          form.append("audio", blob, `voice.${extForMime(recMime)}`);
          const res = await fetch("/api/ai/transcribe", { method: "POST", body: form, credentials: "include" });
          if (!res.ok) {
            console.warn(`[voice-input · continuous] transcribe HTTP ${res.status}`);
            toastTranscribeFailure(res.status);
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
      try { speechRef.current?.abort(); } catch {}
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
