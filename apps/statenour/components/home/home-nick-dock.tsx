"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Send, MessageSquare, Terminal, Search, Inbox, CheckCircle, Activity, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { trpc } from "@/lib/trpc/client";

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

export function HomeNickDock() {
  const router = useRouter();
  const [activeMode, setActiveMode] = useState<DockMode>("ask");
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const remembersQ = trpc.operator.nickRemembersContext.useQuery(undefined, {
    staleTime: 60_000,
  });
  const anticipatedQuestions = remembersQ.data?.anticipatedQuestions ?? [];

  const currentMode = MODES.find((m) => m.key === activeMode) || MODES[0];

  // Auto-grow textarea up to 4 lines
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const max = 4 * 24; // ~24px per line
    ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
  }, [text]);

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

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (activeMode === "search") {
      router.push(`/brain?tab=memory&resolve=${encodeURIComponent(trimmed)}`);
      return;
    }

    const payload = `${currentMode.prefix}${trimmed}`;
    try {
      sessionStorage.setItem("chat:seed", payload);
    } catch {
      // Graceful fallback
    }

    router.push("/chat");
  }, [text, activeMode, currentMode, router]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const canSend = text.trim().length > 0;

  return (
    <div className="w-full relative group">
      {/* Ambient glow that intensifies on focus/hover */}
      <div className="absolute -inset-0.5 bg-gradient-to-r from-[var(--gold)]/0 via-[var(--gold)]/10 to-[var(--gold)]/0 rounded-xl blur opacity-0 group-focus-within:opacity-100 transition duration-1000 group-hover:duration-200" />
      
      <div className="relative w-full glass-card border border-[var(--gold)]/20 bg-black/60 backdrop-blur-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)] p-2 sm:p-3 space-y-2 rounded-xl transition-all">
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
                  setText(q);
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
            value={text}
            onChange={(e) => setText(e.target.value)}
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
              type="button"
              onClick={handleSend}
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
      </div>
    </div>
  );
}
