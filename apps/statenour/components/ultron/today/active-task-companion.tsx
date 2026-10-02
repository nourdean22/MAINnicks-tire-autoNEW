"use client";

/**
 * ActiveTaskCompanion — Apr 19. When a task is DOING on the HQ DESK,
 * this strip appears inline under the task title and turns the tile
 * into a working session: ask Nick, take notes, snap photos, voice
 * record, log progress. Everything ties back to the task via
 * /api/tasks/:id/session so replay is full and the /tasks detail page
 * can render the whole transcript.
 *
 * Design:
 *   • Compact quick-action row (5 buttons) always visible when task
 *     is DOING.
 *   • Tapping Note or Voice expands an inline composer — no modal.
 *   • Tapping Photo opens the camera-capable file input. Base64 data
 *     goes straight to the session endpoint.
 *   • Tapping Ask routes to /chat with the task context pre-filled.
 *   • A tiny "session log" strip below shows the last 1-3 entries so
 *     Nour SEES his notes stack up without leaving HQ.
 *
 * Privacy: all notes/photos/voice stay inside NOUR OS. Nothing leaves
 * the server except via the chat handoff Nour chooses.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import {
  MessageSquareText,
  StickyNote,
  Camera,
  Mic,
  MicOff,
  Sparkles,
  Loader2,
  X,
  Check,
} from "lucide-react";

interface Task {
  id: string;
  title: string;
}

interface SessionEvent {
  id: string;
  kind: "note" | "photo" | "voice" | "log";
  text?: string;
  photoUrl?: string;
  audioUrl?: string;
  durationMs?: number;
  createdAt: string;
}

interface Props {
  task: Task;
  onSessionChange?: () => void;
}

type ComposerMode = "closed" | "note" | "voice";

// ── Web Speech API type surface (Chrome/Edge support) ──
interface SpeechRecognitionResult {
  0: { transcript: string };
}
interface SpeechRecognitionEvent extends Event {
  results: ArrayLike<SpeechRecognitionResult>;
  resultIndex: number;
}
interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onend: ((ev: Event) => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function formatAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function ActiveTaskCompanion({ task, onSessionChange }: Props) {
  const [mode, setMode] = useState<ComposerMode>("closed");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const voiceStartRef = useRef<number>(0);
  // Phase B.6b (2026-05-22) · migrated off `authedFetch` onto
  // `trpc.task.*`. The session read fires imperatively (on mount + after
  // every submit) via `utils.task.session.fetch()`; the event log is a
  // `task.logSessionEvent` mutation. The tRPC procedure returns the
  // service result directly · the legacy `raw.data` envelope unwrap is
  // gone (`getTaskSession` already returns `{ ok, taskId, events }`).
  const utils = trpc.useUtils();
  const logSessionEvent = trpc.task.logSessionEvent.useMutation();

  // Load existing session events so the strip shows the running log.
  const loadSession = useCallback(async () => {
    try {
      const result = await utils.task.session.fetch({ taskId: task.id });
      setEvents((result.events ?? []) as SessionEvent[]);
    } catch {
      /* silent — empty is fine */
    }
  }, [task.id, utils]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSession();
  }, [loadSession]);

  // ── Submit helpers ─────────────────────────────────────────
  const submit = useCallback(
    async (payload: {
      kind: SessionEvent["kind"];
      text?: string;
      photoUrl?: string;
      audioUrl?: string;
      durationMs?: number;
    }) => {
      setBusy(true);
      try {
        await logSessionEvent.mutateAsync({ taskId: task.id, ...payload });
        toast.success(
          payload.kind === "photo"
            ? "photo captured"
            : payload.kind === "voice"
              ? "voice logged"
              : payload.kind === "log"
                ? "logged"
                : "note saved",
        );
        await loadSession();
        onSessionChange?.();
      } catch {
        toast.error("session save failed");
      } finally {
        setBusy(false);
      }
    },
    [task.id, loadSession, onSessionChange, logSessionEvent],
  );

  // ── Note composer ──────────────────────────────────────────
  const saveNote = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    await submit({ kind: "note", text });
    setDraft("");
    setMode("closed");
  }, [draft, submit]);

  // ── Photo capture ──────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const onPhotoPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = String(reader.result ?? "");
        if (!dataUrl.startsWith("data:image")) {
          toast.error("not an image");
          return;
        }
        // Cap at ~1.5MB of base64 to protect the session row.
        if (dataUrl.length > 2_000_000) {
          toast.error("image too large · try a smaller one");
          return;
        }
        await submit({ kind: "photo", photoUrl: dataUrl });
      };
      reader.readAsDataURL(file);
      // Reset so the same file can be picked again later
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [submit],
  );

  // ── Voice capture (Web Speech API transcription) ──────────
  const startVoice = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) {
      toast.error("voice dictation not supported in this browser");
      return;
    }
    try {
      const rec = new SR();
      rec.lang = "en-US";
      rec.continuous = true;
      rec.interimResults = true;
      let final = "";
      rec.onresult = (ev) => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          const text = r[0]?.transcript ?? "";
          // Running interim buffer; final lands in the draft at stop.
          interim += text;
        }
        final = interim;
        setDraft(interim);
      };
      rec.onerror = () => {
        toast.error("voice error");
        setRecording(false);
      };
      rec.onend = () => {
        setRecording(false);
        recognitionRef.current = null;
        if (final.trim().length > 0) {
          const durationMs = Date.now() - voiceStartRef.current;
          submit({ kind: "voice", text: final.trim(), durationMs });
          setDraft("");
          setMode("closed");
        }
      };
      recognitionRef.current = rec;
      voiceStartRef.current = Date.now();
      setRecording(true);
      setMode("voice");
      setDraft("");
      rec.start();
    } catch {
      toast.error("voice start failed");
      setRecording(false);
    }
  }, [submit]);

  const stopVoice = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  // ── Inline one-tap log ────────────────────────────────────
  const logProgress = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      await submit({ kind: "log", text });
    },
    [submit],
  );

  // Chat handoff with task context pre-filled as mention expansion
  const chatHref = `/chat?q=${encodeURIComponent(
    `I'm working on "${task.title}" right now — help me think through it.`,
  )}`;

  const eventCount = events.length;
  const recent = events.slice(-3).reverse();

  return (
    <div className="border-t border-edge-subtle bg-canvas/30">
      {/* ── Quick actions row ───────────────────────────── */}
      <div className="px-3 py-1.5 flex items-center gap-1 flex-wrap">
        <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mr-1">
          <Sparkles size={9} className="inline mr-0.5" />
          session
        </span>

        <Link
          href={chatHref}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-control border text-[13px] font-medium border-blue-500/30 bg-blue-500/5 text-blue-300 hover:bg-blue-500/15 transition-colors"
          title="ask Nick for help with this task"
        >
          <MessageSquareText size={10} /> ask nick
        </Link>

        <button
          onClick={() => {
            setMode(mode === "note" ? "closed" : "note");
            setDraft("");
          }}
          disabled={busy}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-control border text-[13px] font-medium transition-colors",
            mode === "note"
              ? "border-accent bg-accent-soft text-fg"
              : "border-edge-default bg-content text-fg-secondary hover:border-edge-strong hover:text-fg",
            busy && "opacity-40 cursor-not-allowed",
          )}
          title="jot a quick note tied to this task"
        >
          <StickyNote size={10} /> note
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-control border text-[13px] font-medium border-amber-500/30 bg-amber-500/5 text-amber-300 hover:bg-amber-500/15 transition-colors disabled:opacity-40"
          title="capture a photo · ties to task timeline"
        >
          <Camera size={10} /> photo
        </button>

        {recording ? (
          <button
            onClick={stopVoice}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-control border text-[13px] font-medium border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors"
            title="stop voice recording"
          >
            <MicOff size={10} /> stop
          </button>
        ) : (
          <button
            onClick={startVoice}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-control border text-[13px] font-medium border-violet-500/30 bg-violet-500/5 text-violet-300 hover:bg-violet-500/15 transition-colors disabled:opacity-40"
            title="dictate a voice note · transcribes in-browser"
          >
            <Mic size={10} /> voice
          </button>
        )}

        <button
          onClick={() => logProgress(`progress check · ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`)}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-control border text-[13px] font-medium border-emerald-500/30 bg-emerald-500/5 text-emerald-300 hover:bg-emerald-500/15 transition-colors disabled:opacity-40"
          title="log a quick progress timestamp"
        >
          <Check size={10} /> log
        </button>

        {eventCount > 0 && (
          <span className="ml-auto font-mono text-[11px] text-fg-tertiary" title={`${eventCount} session event${eventCount === 1 ? "" : "s"}`}>
            {eventCount}
          </span>
        )}

        {/* Hidden camera-capable file picker */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          title="Upload photo"
          className="hidden"
          onChange={onPhotoPick}
        />
      </div>

      {/* ── Note composer ──────────────────────────────── */}
      {mode === "note" && (
        <div className="px-3 pb-2 flex items-start gap-1.5">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                saveNote();
              }
              if (e.key === "Escape") {
                setMode("closed");
                setDraft("");
              }
            }}
            placeholder="quick note · cmd/ctrl+enter to save"
            rows={2}
            className="flex-1 min-w-0 rounded-control border border-edge-default bg-canvas px-2 py-1 text-[13px] text-fg placeholder:text-fg-tertiary focus:border-accent focus:outline-none resize-none"
          />
          <div className="flex flex-col gap-1 shrink-0">
            <button
              onClick={saveNote}
              disabled={busy || !draft.trim()}
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 w-7 h-7 rounded-control border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-30"
              title="save note"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            </button>
            <button
              onClick={() => {
                setMode("closed");
                setDraft("");
              }}
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 w-7 h-7 rounded-control border border-edge-default text-fg-tertiary hover:border-red-500/40 hover:text-red-400 transition-colors"
              title="cancel"
            >
              <X size={11} />
            </button>
          </div>
        </div>
      )}

      {/* ── Voice preview (while recording) ────────────────── */}
      {mode === "voice" && recording && (
        <div className="px-3 pb-2 flex items-center gap-2">
          <div className="pulse-live w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
          <p className="flex-1 min-w-0 text-[11px] text-fg italic truncate">
            {draft || "listening…"}
          </p>
          <button
            onClick={stopVoice}
            className="shrink-0 text-[13px] font-medium text-red-400 hover:bg-red-500/10 px-1.5 py-0.5 rounded-control"
          >
            stop
          </button>
        </div>
      )}

      {/* ── Session log preview (last 3 entries) ───────────── */}
      {recent.length > 0 && (
        <ul className="border-t border-edge-subtle divide-y divide-edge-subtle">
          {recent.map((e) => (
            <li key={e.id} className="px-3 py-1 flex items-center gap-2 text-[11px]">
              <span
                className={cn(
                  "shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] px-1 py-0 rounded-micro border",
                  e.kind === "note"
                    ? "text-fg-secondary border-edge-default bg-content"
                    : e.kind === "photo"
                      ? "text-amber-400 border-amber-500/30 bg-amber-500/5"
                      : e.kind === "voice"
                        ? "text-violet-400 border-violet-500/30 bg-violet-500/5"
                        : "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
                )}
              >
                {e.kind}
              </span>
              {e.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={e.photoUrl}
                  alt="session capture"
                  className="h-6 w-6 object-cover rounded-control border border-edge-default"
                />
              ) : null}
              <p className="flex-1 min-w-0 truncate text-fg-secondary">
                {e.text || (e.kind === "photo" ? "photo captured" : "—")}
              </p>
              <span className="shrink-0 font-mono text-[11px] text-fg-tertiary">
                {formatAgo(e.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
