"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Send, MessageSquare, Terminal, Search, Inbox, CheckCircle, Activity, Sparkles, Brain, Loader2, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { readBriefStamp, shouldFireBrief, markBriefFired, todayStamp } from "@/lib/home/cognitive-partner-brief";

type DockMode = "ask" | "execute" | "review" | "search" | "capture" | "task";

interface ModeConfig {
  key: DockMode;
  label: string;
  placeholder: string;
  icon: any;
  prefix: string;
}

const MODES: ModeConfig[] = [
  {
    key: "ask",
    label: "Ask",
    placeholder: "Ask Nick anything…",
    icon: MessageSquare,
    prefix: "",
  },
  {
    key: "execute",
    label: "Execute",
    placeholder: "Execute command (e.g. sync leads, refresh stats)…",
    icon: Terminal,
    prefix: "Execute this: ",
  },
  {
    key: "review",
    label: "Review",
    placeholder: "Input code, plans, or decisions to audit…",
    icon: Activity,
    prefix: "Audit this and tell me the strongest move: ",
  },
  {
    key: "search",
    label: "Search Brain",
    placeholder: "Search qualitative context and nodes…",
    icon: Search,
    prefix: "",
  },
  {
    key: "capture",
    label: "Capture",
    placeholder: "Capture idea, link, note, or quote into brain…",
    icon: Inbox,
    prefix: "Capture this into my brain: ",
  },
  {
    key: "task",
    label: "Create Task",
    placeholder: "Task description (e.g. call vendor, deploy fix)…",
    icon: CheckCircle,
    prefix: "Create a task: ",
  },
];

const getMessageText = (m: any) => {
  if (typeof m.content === "string" && m.content) return m.content;
  if (m.parts && Array.isArray(m.parts)) {
    return m.parts
      .filter((p: any) => p.type === "text" && !!p.text)
      .map((p: any) => p.text)
      .join("");
  }
  return "";
};

export function CognitivePartner() {
  const router = useRouter();
  const [activeMode, setActiveMode] = useState<DockMode>("ask");
  const [showAdvancedModes, setShowAdvancedModes] = useState(false);
  const [input, setInput] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const remembersQ = trpc.operator.nickRemembersContext.useQuery(undefined, {
    staleTime: 60_000,
  });
  const anticipatedQuestions = remembersQ.data?.anticipatedQuestions ?? [];

  const currentMode = MODES.find((m) => m.key === activeMode) || MODES[0];
  const primaryModeKeys: DockMode[] = ["ask", "execute", "review"];
  const visibleModes = showAdvancedModes
    ? MODES
    : MODES.filter((mode) => primaryModeKeys.includes(mode.key) || mode.key === activeMode);

  const transport = useMemo(
    // 2026-07-25 · engine unification (audit P1 "competing command
    // centers"): Home's Nick strip now speaks to the CANONICAL chat
    // pipeline instead of the separate tool-less partner-stream route.
    // privateMode:true preserves CP's exact prior semantics — zero
    // persistence (no conversation, no rows, no BrainMemory) — while
    // gaining the full pipeline: provider fallback, output critic,
    // fabrication defenses, honest streaming contract, composer-grade
    // truth machinery. The old route is deleted.
    () => new DefaultChatTransport({
      api: "/api/ai/chat",
      body: { privateMode: true },
    }),
    []
  );

  const { messages, sendMessage, status, setMessages } = useChat({
    id: "cognitive-partner",
    transport,
  });

  const isLoading = status === "streaming" || status === "submitted";

  // Morning brief is a TAP, not an auto-fire (2026-07-25 Home
  // consolidation, operator decision): the old mount effect silently
  // started a paid LLM stream on the first Home visit each day. Now the
  // same once-per-day stamp gates a visible chip instead — the brief
  // stays one tap away, and no spend happens without an explicit tap.
  // Day-stamp helpers unchanged (lib/home/cognitive-partner-brief).
  // 2026-07-26 hydration fix: this was a lazy useState initializer reading
  // localStorage, with a comment claiming "SSR renders false; the client's
  // first render reads the day stamp" — which is exactly the bug. React
  // requires the client's FIRST render to match the server's; branching on
  // localStorage there made the server emit a <div> where the client emitted
  // the brief <button>, and React discarded and re-rendered the whole Home
  // tree on every visit. (Caught by the e2e console-error assertion once the
  // suite stopped crashing before it could report — see PR #1098.)
  // Correct shape: render the SSR-safe value first, then read the stamp in an
  // effect after mount. The chip appears a frame later; nothing else changes.
  const [briefAvailable, setBriefAvailable] = useState(false);
  useEffect(() => {
    // Deferred a tick (react-compiler cascading-render rule): the chip
    // already appeared a frame late by design (hydration-safe SSR-false
    // first paint, see above) — a timeout-0 keeps that contract AND the
    // rule happy. Cleanup prevents a set-after-unmount on fast nav.
    const t = setTimeout(() => {
      try {
        setBriefAvailable(shouldFireBrief(readBriefStamp(), todayStamp()));
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const fireBrief = useCallback(() => {
    const today = todayStamp();
    markBriefFired(today);
    setBriefAvailable(false);
    sendMessage({ text: "Wake up. Give me the morning brief." });
  }, [sendMessage]);

  // Auto-grow textarea up to 4 lines
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const max = 4 * 24; // ~24px per line
    ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
  }, [input]);

  // Global shortcut Cmd/Ctrl+K to focus input
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
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
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  const submitDock = useCallback((e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    // If search mode, just redirect
    if (activeMode === "search") {
      router.push(`/brain?tab=memory&resolve=${encodeURIComponent(trimmed)}`);
      return;
    }

    // Otherwise, handle inline chat for the first few volleys
    setInput("");
    sendMessage({ text: currentMode.prefix + trimmed });
  }, [input, activeMode, currentMode, router, sendMessage]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submitDock();
      }
    },
    [submitDock]
  );

  const canSend = input.trim().length > 0 && !isLoading;
  const visibleMessages = messages.filter((m: any) => getMessageText(m) !== "Wake up. Give me the morning brief.");

  return (
    <div className="w-full relative group space-y-4">
      {/* AI Partner Response Box */}
      {visibleMessages.length > 0 && (
        <div className="relative overflow-hidden rounded-xl border border-edge bg-raised p-4 shadow-lg">
          <div className="flex items-start gap-3">
            <div className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-gold">
              {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Brain size={12} />}
            </div>
            
            <div className="flex-1 space-y-4 text-sm text-zinc-300">
              {visibleMessages.map((msg: any, idx: number) => (
                <div key={idx} className={cn("leading-relaxed whitespace-pre-wrap", msg.role === "user" ? "text-zinc-500 italic" : "text-zinc-200")}>
                  {msg.role === "user" ? `You: ${getMessageText(msg)}` : getMessageText(msg)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Morning-brief chip — visible only until fired today */}
      {briefAvailable && !isLoading && (
        <button
          type="button"
          onClick={fireBrief}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--gold)]/30 bg-[var(--gold)]/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.15em] text-[var(--gold)] transition hover:bg-[var(--gold)]/20 min-h-[36px]"
        >
          <Brain size={12} />
          Morning brief
        </button>
      )}

      {/* Interactive Dock */}
      <div className="relative w-full">
        <form onSubmit={submitDock} className="relative w-full rounded-xl border border-edge bg-base-layer p-2 shadow-lg sm:p-3">
          {/* Mode Selectors */}
          <div className="flex flex-wrap items-center gap-1 border-b border-edge pb-2">
            {visibleModes.map((mode) => {
              const Icon = mode.icon;
              const isActive = mode.key === activeMode;
              return (
                <button
                  key={mode.key}
                  type="button"
                  onClick={() => {
                    setActiveMode(mode.key);
                    taRef.current?.focus();
                  }}
                  className={cn(
                    "inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.15em] transition-colors duration-150",
                    isActive
                      ? "border border-gold/30 bg-gold/10 text-gold"
                      : "border border-transparent text-fg-tertiary hover:bg-raised hover:text-fg"
                  )}
                >
                  <Icon size={12} className={cn(isActive && "text-gold")} />
                  {mode.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setShowAdvancedModes((expanded) => !expanded)}
              aria-expanded={showAdvancedModes}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-transparent px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.15em] text-fg-tertiary transition-colors duration-150 hover:bg-raised hover:text-fg"
            >
              <MoreHorizontal size={12} />
              {showAdvancedModes ? "Less" : "More tools"}
            </button>
          </div>

          {/* Anticipated Questions (Smart Replies) */}
          {anticipatedQuestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-b border-edge px-1 pb-2 pt-1">
              {anticipatedQuestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    setInput(q);
                    taRef.current?.focus();
                  }}
                  className="rounded-full border border-edge bg-raised px-2.5 py-1 text-left text-[11px] text-fg-tertiary transition-colors duration-150 hover:border-gold/30 hover:bg-gold/5 hover:text-gold"
                >
                  <Sparkles size={10} className="inline mr-1 text-[var(--gold)]/70" />
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input Textarea & Send button */}
          <div className="flex items-end gap-2 pt-1 relative">
            <textarea
              ref={taRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={currentMode.placeholder}
              rows={1}
              className={cn(
                "flex-1 min-h-[44px] resize-none bg-transparent px-3 py-2.5 text-[15px] sm:text-[16px] leading-snug",
                "text-white placeholder:text-zinc-600 font-medium",
                "focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:outline-none",
                "transition-colors duration-150"
              )}
            />

            <div className="flex items-center gap-1 shrink-0 pb-1">
              <span className="hidden sm:inline text-[9px] font-mono text-zinc-600 select-none mr-2">
                ⌘↵ to send
              </span>
              <button
                type="submit"
                disabled={!canSend}
                aria-label="send message"
                className={cn(
                  "group/btn inline-flex size-10 items-center justify-center rounded-lg transition-colors duration-150 active:scale-95",
                  canSend
                    ? "bg-gold text-black hover:bg-gold-dim"
                    : "border border-edge bg-raised text-fg-tertiary"
                )}
              >
                <Send size={16} strokeWidth={2.5} className={cn(canSend && "group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform")} />
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
