"use client";

/**
 * /voice · Wave-200 Phase 4 (2026-05-17) · redesigned 2026-05-18 PM
 *
 * Two distinct activities live here:
 *
 *   1. Today's brief · pre-rendered Cartesia audio + the text preview
 *      that explains what the operator's about to hear. PRIMARY surface
 *      on morning visits · this is what the HomeNarrator "brief ready"
 *      link lands on.
 *
 *   2. Live voice session · LiveKit push-to-talk into the Mastra agent.
 *      Secondary surface · for when the operator wants conversation
 *      instead of consumption.
 *
 * Pre-redesign the brief was a small button below the giant LiveKit
 * button. That was wrong for morning intent (operator usually wants
 * the brief, not a call). Now the brief preview leads · the live-call
 * button is visually equal but below.
 *
 * Aesthetic per docs/aesthetic-principles.md:
 *   · text-[var(--text-primary)] body
 *   · gold ONLY on the live-call active state
 *   · 60ch reading width on the brief preview
 *   · canonical .eyebrow class for section labels (0.14em)
 *
 * Architecture (unchanged):
 *   · GET /api/morning-brief returns today's brief text + preview +
 *     composedAt timestamp (NEW · 2026-05-18 PM)
 *   · GET /api/morning-brief/today.mp3 returns the Cartesia-rendered
 *     audio (Phase 5)
 *   · POST /api/voice/token mints a 5-min LiveKit join token
 *   · Python agent worker (apps/voice) auto-joins the operator-{userId}
 *     room
 *
 * See:
 *   - docs/adr/0006-livekit-voice-implementation.md
 *   - docs/adr/0007-morning-brief-multichannel.md
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthedFetch } from "@/hooks/use-authed-fetch";

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

interface BriefPayload {
  ready: boolean;
  date: string;
  composedAt: string | null;
  text: string | null;
  preview: string | null;
}

export default function VoicePage() {
  const [state, setState] = useState<ConnState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string | null>(null);
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
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "unknown error connecting";
      setError(msg);
      setState("error");
      await disconnect();
    }
  }, [disconnect]);

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
      className="min-h-[100dvh] bg-[var(--bg-void,#0A0A0A)] text-[var(--text-primary)] px-6 py-10"
      style={{ overscrollBehavior: "none" }}
    >
      <div className="mx-auto max-w-[60ch] space-y-12">
        {/* Brief section · primary on morning visits */}
        <BriefSection liveCallActive={isLive} />

        {/* Divider · subtle separator between consume vs converse */}
        <div className="border-t border-[var(--border-default,rgba(255,255,255,0.08))]" />

        {/* Live-call section · secondary */}
        <LiveCallSection
          state={state}
          error={error}
          roomName={roomName}
          isLive={isLive}
          onConnect={() => void connect()}
          onDisconnect={() => void disconnect()}
        />
      </div>

      {/* hidden audio sink the SDK attaches subscriber tracks to */}
      <audio id="voice-output" autoPlay playsInline className="hidden" />
    </main>
  );
}

// ── Brief section · brief preview + play button ─────────────────────

function BriefSection({ liveCallActive }: { liveCallActive: boolean }) {
  const { data: brief } = useAuthedFetch<BriefPayload>("/api/morning-brief");
  const [playState, setPlayState] = useState<
    "idle" | "loading" | "playing" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const play = useCallback(async () => {
    if (liveCallActive) return;
    setErrorMsg(null);
    setPlayState("loading");
    try {
      const audio = audioRef.current;
      if (!audio) {
        setPlayState("error");
        setErrorMsg("audio element missing");
        return;
      }
      audio.src = "/api/morning-brief/today.mp3";
      audio.onended = () => setPlayState("idle");
      audio.onerror = () => {
        setPlayState("error");
        setErrorMsg("playback failed · audio may not be rendered yet");
      };
      await audio.play();
      setPlayState("playing");
    } catch (err) {
      setPlayState("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [liveCallActive]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setPlayState("idle");
  }, []);

  const composedAt = brief?.composedAt
    ? new Date(brief.composedAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      })
    : null;

  return (
    <section className="space-y-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        Today's brief{composedAt ? ` · composed ${composedAt}` : ""}
      </p>

      {brief == null ? (
        <p className="text-sm text-[var(--text-secondary)]">Loading…</p>
      ) : brief.ready ? (
        <>
          {brief.preview ? (
            <blockquote className="text-base sm:text-lg leading-relaxed text-[var(--text-primary)] border-l-2 border-[var(--gold)]/30 pl-4">
              {brief.preview}
            </blockquote>
          ) : null}
          <button
            type="button"
            onClick={playState === "playing" ? stop : () => void play()}
            disabled={liveCallActive || playState === "loading"}
            className={[
              "inline-flex items-center gap-2 px-5 py-3 min-h-[44px] rounded-md text-sm font-medium",
              "border transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60",
              liveCallActive
                ? "opacity-30 cursor-not-allowed border-[var(--border-default,rgba(255,255,255,0.15))]"
                : playState === "playing"
                  ? "border-[var(--gold)] bg-[var(--gold)]/10 text-[var(--gold)]"
                  : "border-[var(--gold)]/40 bg-[var(--gold)]/[0.04] text-[var(--text-primary)] hover:border-[var(--gold)]/80 hover:bg-[var(--gold)]/[0.08]",
            ].join(" ")}
          >
            {playState === "loading"
              ? "Loading…"
              : playState === "playing"
                ? "■ Stop"
                : playState === "error"
                  ? "Retry"
                  : "▶ Play brief"}
          </button>
          {errorMsg ? (
            <p className="text-xs text-red-300">{errorMsg}</p>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-[var(--text-secondary)]">
          No brief composed yet for today · the cron runs at 10:00 UTC.
          Check back, or trigger via /api/cron/morning-brief manually.
        </p>
      )}

      <audio ref={audioRef} preload="none" />
    </section>
  );
}

// ── Live-call section · LiveKit push-to-talk ────────────────────────

function LiveCallSection({
  state,
  error,
  roomName,
  isLive,
  onConnect,
  onDisconnect,
}: {
  state: ConnState;
  error: string | null;
  roomName: string | null;
  isLive: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <section className="space-y-4 flex flex-col items-center text-center">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)] self-start">
        Talk to Nick
      </p>
      <p className="text-sm text-[var(--text-secondary)] max-w-sm">
        Tap to start a voice session · the agent listens and speaks back.
        Tap again to end.
      </p>

      <button
        type="button"
        onClick={isLive ? onDisconnect : onConnect}
        className={[
          "relative w-40 h-40 sm:w-48 sm:h-48 rounded-full select-none",
          "transition-all duration-200 ease-out",
          "border border-[var(--border-default,rgba(255,255,255,0.15))]",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60",
          "active:scale-[0.97]",
          isLive
            ? "bg-[var(--gold)] text-black shadow-[0_0_60px_rgba(253,185,19,0.35)]"
            : "bg-white/[0.04] hover:bg-white/[0.08]",
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

      <div className="min-h-[2rem]">
        {roomName ? (
          <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            room · {roomName}
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 text-sm text-red-300 max-w-xs">{error}</p>
        ) : null}
      </div>
    </section>
  );
}
