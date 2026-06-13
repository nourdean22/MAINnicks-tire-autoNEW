"use client";

/**
 * MultiTurnChat · /tasks v2.2 Phase 5 FULL · 2026-05-26
 *
 * Replaces PageNick (single-shot Q&A) inside NickSidePane with a real
 * back-and-forth thread. Operator asks → Nick streams reply → operator
 * follows up → Nick maintains context across turns.
 *
 * Architecture:
 *   - Client owns the thread state (Array<{role, content, ts}>)
 *   - Persists to localStorage per-page so the thread survives reload
 *   - Each send POSTs the full history to /api/ai/side-pane-chat
 *   - Stream chunks append to the in-flight assistant message
 *   - AbortController lets operator cancel mid-stream
 *
 * State persistence intentionally CLIENT-ONLY in this commit · no
 * server-side conversation thread mode (operator's existing /chat
 * page handles that). Thread state is per-device, per-page. Operator
 * who wants cross-device persistence opens /chat directly.
 *
 * Visual contract · editorial-minimalist gold-accent · matches the
 * PageNick aesthetic for consistency · auto-scroll on stream · scroll-
 * isolated within the side-pane scroll container.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Send, RotateCcw, Loader2, User, Brain } from "lucide-react";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  ts: string; // ISO timestamp
}

interface MultiTurnChatProps {
  /** Page identifier · drives system prompt framing + page-data fetch. */
  page: string;
  /** Optional structured data to inject as the page context. */
  data?: unknown;
  /** Optional focus line that biases the analysis. */
  focus?: string;
  /** Pre-set quick-question pills · click fires immediately. */
  presets?: string[];
}

/** Cap on retained turns · trims the head when exceeded to keep
 *  localStorage payload small + prompts under model context limits. */
const MAX_TURNS = 24;
const STORAGE_PREFIX = "nour:side-pane-thread:v1:";

function storageKey(page: string): string {
  return `${STORAGE_PREFIX}${page}`;
}

function readStored(page: string): ChatTurn[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(page));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatTurn[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t) =>
          t &&
          typeof t.content === "string" &&
          (t.role === "user" || t.role === "assistant") &&
          typeof t.ts === "string",
      )
      .slice(-MAX_TURNS);
  } catch {
    return [];
  }
}

function writeStored(page: string, turns: ChatTurn[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(page), JSON.stringify(turns.slice(-MAX_TURNS)));
  } catch {
    /* private browsing or quota exceeded · fail silent · in-memory state still works */
  }
}

export function MultiTurnChat({ page, data, focus, presets }: MultiTurnChatProps) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Restore on mount.
  useEffect(() => {
    setTurns(readStored(page));
  }, [page]);

  // Mobile sweep #3 (2026-05-27) · auto-focus the input on mount so the
  // operator's first keystroke lands in the chat after tapping the brain
  // FAB. iOS Safari blocks programmatic focus outside a user gesture, but
  // the FAB tap that mounts this component IS the user gesture in the
  // same React tick · the focus call succeeds. If it ever doesn't (iOS
  // PWA edge cases), the input is still tappable.
  useEffect(() => {
    // Small timeout lets the sheet's slide-in animation settle so the
    // keyboard appearing doesn't fight the panel transition.
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  // Auto-scroll when turns change or while streaming.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;
      setError(null);

      // Append user turn + a placeholder assistant turn that will fill
      // as the stream arrives.
      const userTurn: ChatTurn = { role: "user", content: trimmed, ts: new Date().toISOString() };
      const placeholder: ChatTurn = { role: "assistant", content: "", ts: new Date().toISOString() };
      const nextHistory = [...turns, userTurn];
      const inflight = [...nextHistory, placeholder];
      setTurns(inflight);
      writeStored(page, inflight);
      setInput("");
      setStreaming(true);

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        const res = await fetch("/api/ai/side-pane-chat", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            page,
            focus,
            data,
            messages: nextHistory.map((t) => ({ role: t.role, content: t.content })),
          }),
          signal: abortRef.current.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          // Strip <think> blocks defensively (matches PageNick).
          const visible = accumulated
            .replace(/<think>[\s\S]*?<\/think>/gi, "")
            .replace(/<\/?think>/gi, "")
            .trimStart();
          setTurns((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = { ...last, content: visible };
            }
            return next;
          });
        }
        // Final persist with the complete response.
        setTurns((prev) => {
          writeStored(page, prev);
          return prev;
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("abort")) {
          // Operator cancelled · drop the empty placeholder.
          setTurns((prev) => {
            const next = prev.filter((t, i) => !(i === prev.length - 1 && t.role === "assistant" && !t.content));
            writeStored(page, next);
            return next;
          });
        } else {
          setError(msg);
          setTurns((prev) => {
            const next = prev.filter((t, i) => !(i === prev.length - 1 && t.role === "assistant" && !t.content));
            writeStored(page, next);
            return next;
          });
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [page, data, focus, streaming, turns],
  );

  // Listen for the custom "statenour:open-nick" event to receive pre-filled prompt and submit it.
  useEffect(() => {
    function handleOpenNick(e: Event) {
      const customEvent = e as CustomEvent<{ pendingPrompt: string; submitOnMount?: boolean }>;
      const prompt = customEvent.detail?.pendingPrompt;
      if (!prompt) return;

      setInput(prompt);
      
      // Auto-focus input
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);

      if (customEvent.detail.submitOnMount) {
        // Wait a brief moment to allow side-pane to mount/open and thread state to initialize
        setTimeout(() => {
          void send(prompt);
        }, 300);
      }
    }
    window.addEventListener("statenour:open-nick", handleOpenNick);
    return () => window.removeEventListener("statenour:open-nick", handleOpenNick);
  }, [send]);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
    writeStored(page, []);
    setError(null);
  }, [page]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Header · turn count + clear thread */}
      {turns.length > 0 && (
        <div className="flex items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-[0.18em]">
          <span className="text-[var(--text-tertiary)]">
            {turns.filter((t) => t.role === "user").length} turn
            {turns.filter((t) => t.role === "user").length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={clear}
            disabled={streaming}
            aria-label="clear conversation"
            className="inline-flex min-h-[36px] items-center gap-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40 rounded px-2 disabled:opacity-50"
          >
            <RotateCcw size={12} strokeWidth={1.75} />
            clear
          </button>
        </div>
      )}

      {/* Thread · scroll-isolated · auto-bottom on new turn */}
      <div ref={scrollRef} className="flex flex-col gap-2.5 max-h-[60vh] overflow-y-auto pr-1">
        {turns.length === 0 && (
          <div className="rounded-md border border-[var(--gold)]/20 bg-[var(--gold)]/[0.03] px-3 py-3">
            <p className="text-[12px] text-[var(--text-secondary)] leading-snug">
              Ask Nick about this {page}. Multi-turn · thread persists per device. Click a preset
              below or type a question.
            </p>
          </div>
        )}
        {turns.map((turn, i) => (
          <ChatBubble key={`${turn.ts}-${i}`} turn={turn} />
        ))}
        {streaming && turns[turns.length - 1]?.role === "assistant" && !turns[turns.length - 1].content && (
          <div className="inline-flex items-center gap-1.5 text-[10px] font-mono text-[var(--text-tertiary)] ml-7">
            <Loader2 size={10} className="animate-spin" strokeWidth={1.75} />
            thinking
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-[11px] text-red-300/90">
          {error}
        </div>
      )}

      {/* Presets · only show when thread is empty (operator can ask
       *  follow-ups by typing once the thread is active). */}
      {turns.length === 0 && presets && presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {presets.slice(0, 4).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => void send(preset)}
              disabled={streaming}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--gold)]/30 bg-[var(--gold)]/[0.05] px-3 py-1.5 text-[11px] text-[var(--gold)] hover:bg-[var(--gold)]/[0.10] disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40"
            >
              {preset}
            </button>
          ))}
        </div>
      )}

      {/* Composer · text input + send. 16px font (iOS no-zoom) ·
       *  44pt touch targets on both input + send (Apple HIG mobile floor ·
       *  bumped from 40 → 44 in the 2026-05-26 mobile-tightening pass). */}
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={turns.length === 0 ? "Ask Nick · type a question…" : "Follow up…"}
          disabled={streaming}
          className="flex-1 min-h-[44px] rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.08] px-3 py-1.5 text-[16px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]/70 focus:border-[var(--gold)]/40 focus:outline-none transition-colors disabled:opacity-50"
          aria-label="message"
          autoComplete="off"
          spellCheck
        />
        <button
          type="submit"
          disabled={!input.trim() || streaming}
          aria-label="send"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[var(--gold)]/50 bg-[var(--gold)]/10 text-[var(--gold)] hover:bg-[var(--gold)]/15 disabled:opacity-40 disabled:hover:bg-[var(--gold)]/10 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40"
        >
          {streaming ? (
            <Loader2 size={14} className="animate-spin" strokeWidth={1.75} />
          ) : (
            <Send size={14} strokeWidth={1.75} />
          )}
        </button>
      </form>
    </div>
  );
}

/* ─── Bubble · message rendering ───────────────────────────────── */

function ChatBubble({ turn }: { turn: ChatTurn }) {
  const isUser = turn.role === "user";
  return (
    <div className={cn("flex gap-2", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-[var(--bg-raised)]/[0.2] text-[var(--text-secondary)]"
            : "bg-[var(--gold)]/[0.15] text-[var(--gold)]",
        )}
      >
        {isUser ? <User size={10} strokeWidth={1.75} /> : <Brain size={10} strokeWidth={1.75} />}
      </div>
      <div
        className={cn(
          "max-w-[calc(100%-28px)] rounded-md px-3 py-2 text-[12px] leading-snug whitespace-pre-wrap break-words",
          isUser
            ? "bg-[var(--bg-raised)]/[0.12] text-[var(--text-primary)]"
            : "bg-[var(--gold)]/[0.04] text-[var(--text-primary)] border border-[var(--gold)]/15",
        )}
      >
        {turn.content || (turn.role === "assistant" ? "…" : "")}
      </div>
    </div>
  );
}
