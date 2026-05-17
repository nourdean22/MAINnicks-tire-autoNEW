"use client";

/**
 * /voice · Wave-200 Phase 4 (2026-05-17)
 *
 * PWA-installable push-to-talk launcher into the operator's personal
 * LiveKit voice loop. Tap to connect · tap again to disconnect.
 *
 * Architecture:
 *   · This page mints a LiveKit join token via POST /api/voice/token
 *     (owner-only · 5min TTL)
 *   · Connects to LiveKit Cloud via WebRTC using the official client
 *     SDK (@livekit/components-react is the React surface · we use
 *     the lower-level client SDK because we only need one room +
 *     one participant + push-to-talk semantics)
 *   · The Python agent worker (apps/voice) is already listening for
 *     jobs on the operator-{userId} room · joins automatically
 *
 * Graceful degrades:
 *   · 503 from /api/voice/token → show "voice not configured" with
 *     link to ADR-0006 for setup steps
 *   · Microphone permission denied → show "grant mic access · refresh"
 *   · Disconnect mid-call → reconnect attempt with backoff (LiveKit
 *     SDK handles this natively · we surface status)
 *
 * See:
 *   - docs/adr/0006-livekit-voice-implementation.md
 *   - app/api/voice/token/route.ts
 *   - apps/voice/agent.py
 */

import { useCallback, useEffect, useRef, useState } from "react";

type ConnState =
  | "idle"
  | "minting"
  | "connecting"
  | "connected"
  | "speaking"
  | "listening"
  | "disconnected"
  | "error";

interface VoiceToken {
  url: string;
  token: string;
  room: string;
  identity: string;
  expiresInSeconds: number;
}

export default function VoicePage() {
  const [state, setState] = useState<ConnState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string | null>(null);
  // Holds the LiveKit Room object once connected. Typed loosely
  // because we lazy-import the SDK below (keeps the page bundle
  // small for cold visits that never tap the button).
  const roomRef = useRef<unknown | null>(null);

  const disconnect = useCallback(async () => {
    const room = roomRef.current as { disconnect: () => Promise<void> } | null;
    if (room) {
      try {
        await room.disconnect();
      } catch {
        // swallow · already disconnected
      }
      roomRef.current = null;
    }
    setState("disconnected");
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setState("minting");

    try {
      const res = await fetch("/api/voice/token", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message =
          body?.hint ??
          body?.error ??
          `token endpoint returned ${res.status}`;
        throw new Error(message);
      }
      const data = (await res.json()) as VoiceToken;
      setRoomName(data.room);
      setState("connecting");

      // Lazy import keeps livekit-client out of the initial bundle ·
      // page renders instantly · SDK only loads when the operator
      // taps "connect".
      const { Room, RoomEvent } = await import("livekit-client");
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: { dtx: true },
      });
      roomRef.current = room;

      room.on(RoomEvent.Disconnected, () => setState("disconnected"));
      room.on(RoomEvent.Connected, () => setState("connected"));
      room.on(RoomEvent.LocalTrackPublished, () => setState("listening"));
      room.on(RoomEvent.TrackSubscribed, (track) => {
        // Auto-attach the agent's audio to a hidden <audio> so the
        // operator hears the reply. LiveKit SDK handles browser
        // audio-context init when triggered via user gesture (the
        // initial Connect tap counts).
        if (track.kind === "audio") {
          const el = document.getElementById("voice-output") as
            | HTMLAudioElement
            | null;
          if (el) {
            track.attach(el);
            setState("speaking");
          }
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, () => setState("listening"));

      await room.connect(data.url, data.token);
      // Enable microphone immediately · single-tap UX.
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "unknown error connecting";
      setError(msg);
      setState("error");
      await disconnect();
    }
  }, [disconnect]);

  // Auto-disconnect on unmount.
  useEffect(() => {
    return () => {
      void disconnect();
    };
  }, [disconnect]);

  const isLive =
    state === "connecting" ||
    state === "connected" ||
    state === "listening" ||
    state === "speaking";

  return (
    <main
      className="min-h-[100dvh] bg-[#0A0A0A] text-white flex flex-col items-center justify-center px-6 py-10"
      // Lock the viewport so the PTT UI fills the screen · phone-first
      style={{ overscrollBehavior: "none" }}
    >
      <h1 className="text-xs uppercase tracking-[0.18em] text-white/40 mb-3">
        Nick · voice
      </h1>
      <p className="text-white/60 text-sm mb-12 text-center max-w-xs">
        Tap to start a voice session · the agent listens and speaks back.
        Tap again to end.
      </p>

      <button
        type="button"
        onClick={isLive ? () => void disconnect() : () => void connect()}
        className={[
          "relative w-56 h-56 rounded-full select-none",
          "transition-all duration-200 ease-out",
          "border border-white/10",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FDB913]/60",
          "active:scale-[0.97]",
          isLive
            ? "bg-[#FDB913] text-black shadow-[0_0_60px_rgba(253,185,19,0.35)]"
            : "bg-white/[0.04] text-white hover:bg-white/[0.08]",
          state === "minting" || state === "connecting"
            ? "opacity-70 pointer-events-none"
            : "",
        ].join(" ")}
        aria-pressed={isLive}
        aria-label={isLive ? "end voice session" : "start voice session"}
      >
        <span className="block text-base font-medium">
          {state === "idle" && "Start"}
          {state === "minting" && "Minting…"}
          {state === "connecting" && "Connecting…"}
          {state === "connected" && "Connected"}
          {state === "listening" && "Listening"}
          {state === "speaking" && "Nick speaking"}
          {state === "disconnected" && "Start again"}
          {state === "error" && "Retry"}
        </span>
      </button>

      <div className="mt-8 text-center min-h-[3rem]">
        {roomName ? (
          <p className="text-[10px] uppercase tracking-[0.22em] text-white/30">
            room · {roomName}
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 text-sm text-red-300 max-w-xs">{error}</p>
        ) : null}
      </div>

      {/* 2026-05-17 follow-up · Play-today's-brief shortcut.
          Pre-rendered audio at /api/morning-brief/today.mp3 (Phase 5).
          Single-tap autoplay. Disabled while a voice session is live
          so playback doesn't compete with the LiveKit downlink. */}
      <PlayTodaysBriefButton disabled={isLive} />

      {/* hidden audio sink the SDK attaches subscriber tracks to */}
      <audio id="voice-output" autoPlay playsInline className="hidden" />
    </main>
  );
}

// ── Play today's brief ──────────────────────────────────────────────

type BriefPlayState = "idle" | "loading" | "playing" | "missing" | "error";

function PlayTodaysBriefButton({ disabled }: { disabled: boolean }) {
  const [state, setState] = useState<BriefPlayState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const play = useCallback(async () => {
    if (disabled) return;
    setErrorMsg(null);
    setState("loading");
    try {
      // HEAD probe first · cheap way to surface "no audio today" vs
      // "audio downloading". The endpoint already does the BrainMemory
      // read so HEAD is the same cost path.
      const head = await fetch("/api/morning-brief/today.mp3", { method: "HEAD" });
      if (head.status === 404) {
        setState("missing");
        return;
      }
      if (!head.ok) {
        setState("error");
        setErrorMsg(`audio fetch failed · ${head.status}`);
        return;
      }
      const audio = audioRef.current;
      if (!audio) {
        setState("error");
        setErrorMsg("audio element missing");
        return;
      }
      audio.src = "/api/morning-brief/today.mp3";
      audio.onended = () => setState("idle");
      audio.onerror = () => {
        setState("error");
        setErrorMsg("playback failed");
      };
      await audio.play();
      setState("playing");
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [disabled]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setState("idle");
  }, []);

  const isPlaying = state === "playing";
  const label =
    state === "loading"
      ? "Loading…"
      : state === "playing"
        ? "Stop brief"
        : state === "missing"
          ? "No brief today"
          : state === "error"
            ? "Retry brief"
            : "Play today's brief";

  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={isPlaying ? stop : () => void play()}
        disabled={disabled || state === "loading"}
        className={[
          "px-4 py-2 rounded-full text-sm",
          "border border-white/15",
          "transition-colors",
          disabled
            ? "opacity-40 cursor-not-allowed"
            : "hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FDB913]/60",
          state === "missing" ? "text-white/40" : "text-white/80",
        ].join(" ")}
        aria-label={label}
      >
        {label}
      </button>
      {errorMsg ? (
        <p className="text-xs text-red-300 max-w-xs text-center">{errorMsg}</p>
      ) : null}
      <audio ref={audioRef} preload="none" />
    </div>
  );
}
