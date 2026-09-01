"use client";

/**
 * NickCommandLine — section 3: Nick as the command layer, collapsed to one
 * line. Replaces CognitivePartner's six mode buttons + "More tools" +
 * always-visible chip rows with a single input and slash routing:
 *
 *   /task /capture /search /review /execute  — or plain text to just ask.
 *
 * The power is unchanged — every mode maps to the exact prefix the old
 * mode buttons applied, and the pipeline is the SAME canonical chat
 * transport (privateMode:true → zero persistence, full provider fallback +
 * fabrication defenses; see the 2026-07-25 engine-unification note this
 * inherits). Only the surface area shrank (Apple HIG: keep capabilities
 * close, include only what's necessary).
 *
 * Disclosure rules:
 *   · slash menu renders only while the input starts with "/"
 *   · anticipated-question chips render only while focused AND empty
 *   · the morning-brief chip keeps its once-per-day stamp contract
 *     (lib/home/cognitive-partner-brief) — stamp read stays inside an
 *     effect (home-hydration-safety.test locks this)
 *   · "/" focuses the line from anywhere on the page; ⌘K stays the app
 *     command palette (CognitivePartner's old ⌘K listener collided with it)
 *
 * Deliberately absent: a mic button. Voice transcription rides the prod
 * OpenAI key, which is dead (whisper 401, 2026-08-27 memory) — shipping a
 * control wired to a dead API is the exact "never-wired button" failure
 * mode this redesign exists to kill.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Send, Brain, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { trpc } from "@/lib/trpc/client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  readBriefStamp,
  shouldFireBrief,
  markBriefFired,
  todayStamp,
} from "@/lib/home/cognitive-partner-brief";

interface SlashCommand {
  key: string;
  /** Typed form, e.g. "/task". */
  token: string;
  hint: string;
  /** Prefix applied to the chat message (identical to the old mode). */
  prefix: string;
  /** "search" routes instead of chatting. */
  routes?: boolean;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { key: "task", token: "/task", hint: "create a task", prefix: "Create a task: " },
  { key: "capture", token: "/capture", hint: "capture into brain", prefix: "Capture this into my brain: " },
  { key: "search", token: "/search", hint: "search brain memory", prefix: "", routes: true },
  { key: "review", token: "/review", hint: "audit a plan or decision", prefix: "Audit this and tell me the strongest move: " },
  { key: "execute", token: "/execute", hint: "run a command", prefix: "Execute this: " },
];

/** Parse a submission into its command (if any) and the remaining text. */
export function parseSlash(input: string): { command: SlashCommand | null; text: string } {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { command: null, text: trimmed };
  const space = trimmed.indexOf(" ");
  const token = space === -1 ? trimmed : trimmed.slice(0, space);
  const command = SLASH_COMMANDS.find((c) => c.token === token.toLowerCase()) ?? null;
  if (!command) return { command: null, text: trimmed };
  return { command, text: space === -1 ? "" : trimmed.slice(space + 1).trim() };
}

const WAKE_MESSAGE = "Wake up. Give me the morning brief.";

const getMessageText = (m: unknown): string => {
  const msg = m as { content?: unknown; parts?: Array<{ type?: string; text?: string }> };
  if (typeof msg.content === "string" && msg.content) return msg.content;
  if (Array.isArray(msg.parts)) {
    return msg.parts
      .filter((p) => p.type === "text" && !!p.text)
      .map((p) => p.text)
      .join("");
  }
  return "";
};

export function NickCommandLine() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const remembersQ = trpc.operator.nickRemembersContext.useQuery(undefined, {
    staleTime: 60_000,
  });
  const anticipatedQuestions = remembersQ.data?.anticipatedQuestions ?? [];

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/ai/chat",
        body: { privateMode: true },
      }),
    [],
  );

  const { messages, sendMessage, status } = useChat({
    id: "nick-command-line",
    transport,
  });
  const isLoading = status === "streaming" || status === "submitted";

  // Morning-brief chip: SSR-false first paint, stamp read deferred to an
  // effect (the 2026-07-26 hydration lesson, verbatim from CognitivePartner).
  const [briefAvailable, setBriefAvailable] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setBriefAvailable(shouldFireBrief(readBriefStamp(), todayStamp()));
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const fireBrief = useCallback(() => {
    markBriefFired(todayStamp());
    setBriefAvailable(false);
    sendMessage({ text: WAKE_MESSAGE });
  }, [sendMessage]);

  // Auto-grow up to 4 lines.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 4 * 24)}px`;
  }, [input]);

  // "/" focuses the command line from anywhere (⌘K belongs to the palette).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.hasAttribute("contenteditable"))
      ) {
        return;
      }
      e.preventDefault();
      taRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = useCallback(
    (e?: React.FormEvent<HTMLFormElement>) => {
      e?.preventDefault();
      const { command, text } = parseSlash(input);
      // A bare command ("/task" with nothing after it) is a no-op — sending
      // a naked prefix to the pipeline would be a junk paid call.
      if (!text) return;

      if (command?.routes) {
        // /search — same brain resolve deep link the old Search mode used.
        router.push(`/brain?tab=memory&resolve=${encodeURIComponent(text)}`);
        return;
      }

      setInput("");
      sendMessage({ text: `${command?.prefix ?? ""}${text}` });
    },
    [input, router, sendMessage],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends; Shift+Enter breaks a line; ⌘/Ctrl+Enter also sends
      // (muscle memory from the old dock).
      if (e.key === "Enter" && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const slashMenu = input.startsWith("/")
    ? SLASH_COMMANDS.filter((c) => c.token.startsWith(input.trim().split(" ")[0].toLowerCase()))
    : [];
  const showChips = focused && input.length === 0 && anticipatedQuestions.length > 0;
  const canSend = !isLoading && parseSlash(input).text.length > 0;
  const visibleMessages = messages.filter((m) => getMessageText(m) !== WAKE_MESSAGE);

  return (
    <div className="w-full space-y-3">
      {visibleMessages.length > 0 && (
        <div
          className="rounded-xl border border-edge bg-raised p-4"
          role="log"
          aria-label="Nick's response"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-gold">
              {isLoading ? <Loader2 size={12} className="motion-safe:animate-spin" /> : <Brain size={12} />}
            </div>
            <div className="min-w-0 flex-1 space-y-3 text-sm">
              {visibleMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "whitespace-pre-wrap leading-relaxed",
                    msg.role === "user" ? "italic text-fg-tertiary" : "text-fg",
                  )}
                >
                  {msg.role === "user" ? `You: ${getMessageText(msg)}` : getMessageText(msg)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <form
        onSubmit={submit}
        className="relative rounded-xl border border-edge bg-base-layer transition-colors duration-150 focus-within:border-edge-hover"
      >
        {slashMenu.length > 0 && (
          <ul aria-label="commands" className="border-b border-edge px-2 py-1.5">
            {slashMenu.map((c) => (
              <li key={c.key}>
                <button
                  type="button"
                  onClick={() => {
                    setInput(`${c.token} `);
                    taRef.current?.focus();
                  }}
                  className="flex min-h-[36px] w-full items-baseline gap-3 rounded-md px-2 text-left transition-colors duration-150 hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
                >
                  <span className="font-mono text-[12px] text-gold">{c.token}</span>
                  <span className="text-[11px] text-fg-tertiary">{c.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {showChips && (
          <div className="flex flex-wrap gap-1.5 border-b border-edge px-3 py-2">
            {anticipatedQuestions.slice(0, 3).map((q) => (
              <button
                key={q}
                type="button"
                // onMouseDown so the tap wins the race against the
                // textarea's blur (which would unmount this chip first).
                onMouseDown={(e) => {
                  e.preventDefault();
                  setInput(q);
                  taRef.current?.focus();
                }}
                className="rounded-full border border-edge bg-raised px-2.5 py-1 text-left text-[11px] text-fg-tertiary transition-colors duration-150 hover:border-gold/30 hover:text-gold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 p-2">
          <label htmlFor="nick-line" className="sr-only">
            Ask, decide, capture, search, or execute
          </label>
          {/* Placeholder short on purpose: the full verb set lives in the
              "/" menu (progressive disclosure) — the seven-word line wrapped
              to three clipped lines inside a one-row textarea on a 375px
              phone. */}
          <textarea
            id="nick-line"
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Ask Nick, or / for commands…"
            rows={1}
            className="min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] leading-snug text-fg placeholder:text-fg-tertiary focus:outline-none sm:text-[16px]"
          />
          <div className="flex shrink-0 items-center gap-2 pb-1">
            <span className="hidden select-none font-mono text-[9px] text-fg-tertiary sm:inline">
              / to focus
            </span>
            <button
              type="submit"
              disabled={!canSend}
              aria-label="send"
              className={cn(
                "inline-flex size-10 items-center justify-center rounded-lg transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold",
                canSend
                  ? "bg-gold text-black hover:bg-gold-dim"
                  : "border border-edge bg-raised text-fg-tertiary",
              )}
            >
              <Send size={15} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </form>

      {/* Morning-brief chip: its own quiet row below the line — inside the
          input row it crowded the 375px textarea. Visible only until fired
          today (stamp contract above); the tap starts a paid stream, so it
          stays a tap, never an auto-fire (2026-07-25 operator decision). */}
      {briefAvailable && !isLoading && (
        <button
          type="button"
          onClick={fireBrief}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/10 px-3 text-[10px] font-mono uppercase tracking-[0.12em] text-gold transition-colors duration-150 hover:bg-gold/20 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
        >
          <Brain size={11} />
          Morning brief
        </button>
      )}
    </div>
  );
}
