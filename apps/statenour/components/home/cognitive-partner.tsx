"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Send, MessageSquare, Terminal, Search, Inbox, CheckCircle, Activity, Sparkles, Brain, Loader2 } from "lucide-react";
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
  const [input, setInput] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const remembersQ = trpc.operator.nickRemembersContext.useQuery(undefined, {
    staleTime: 60_000,
  });
  const anticipatedQuestions = remembersQ.data?.anticipatedQuestions ?? [];

  const currentMode = MODES.find((m) => m.key === activeMode) || MODES[0];

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
    try {
      setBriefAvailable(shouldFireBrief(readBriefStamp(), todayStamp()));
    } catch {}
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
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-black/80 to-zinc-900/80 border border-[var(--gold)]/20 p-4 shadow-[0_0_30px_rgba(255,215,0,0.05)] backdrop-blur-xl">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[var(--gold)]/50 to-transparent opacity-50" />
          
          <div className="flex items-start gap-3">
            <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--gold)]/20 text-[var(--gold)] border border-[var(--gold)]/40 shadow-[0_0_10px_rgba(255,215,0,0.3)]">
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
        <div className="absolute -inset-0.5 bg-gradient-to-r from-[var(--gold)]/0 via-[var(--gold)]/10 to-[var(--gold)]/0 rounded-xl blur opacity-0 group-focus-within:opacity-100 transition duration-1000 group-hover:duration-200" />
        
        <form onSubmit={submitDock} className="relative w-full glass-card border border-[var(--gold)]/20 bg-black/60 backdrop-blur-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)] p-2 sm:p-3 space-y-2 rounded-xl transition-all">
          {/* Mode Selectors */}
          <div className="flex items-center gap-1 overflow-x-auto pb-2 border-b border-white/5 scrollbar-none mask-fade-edges-x">
            {MODES.map((mode) => {
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
                    "shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase tracking-[0.15em] transition-all duration-300 inline-flex items-center gap-1.5 min-h-[36px]",
                    isActive
                      ? "bg-gradient-to-br from-[var(--gold)]/10 to-[var(--gold)]/5 text-[var(--gold)] border border-[var(--gold)]/30 shadow-[0_0_10px_rgba(255,215,0,0.1)]"
                      : "text-zinc-500 border border-transparent hover:text-zinc-300 hover:bg-white/[0.02]"
                  )}
                >
                  <Icon size={12} className={cn(isActive && "text-[var(--gold)] animate-pulse")} />
                  {mode.label}
                </button>
              );
            })}
          </div>

          {/* Anticipated Questions (Smart Replies) */}
          {anticipatedQuestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1 px-1 border-b border-white/5 pb-2">
              {anticipatedQuestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    setInput(q);
                    taRef.current?.focus();
                  }}
                  className="px-2.5 py-1 rounded-full text-[11px] bg-zinc-900/50 border border-white/5 text-zinc-400 hover:text-[var(--gold)] hover:border-[var(--gold)]/30 hover:bg-[var(--gold)]/5 transition-all text-left"
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
                "transition-all duration-300"
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
                  "inline-flex items-center justify-center h-10 w-10 rounded-lg transition-all duration-300 active:scale-95 group/btn",
                  canSend
                    ? "bg-gradient-to-br from-[var(--gold)] to-amber-500 text-black shadow-[0_0_15px_rgba(255,215,0,0.4)] hover:shadow-[0_0_25px_rgba(255,215,0,0.6)]"
                    : "bg-zinc-900 text-zinc-700 border border-white/5"
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
