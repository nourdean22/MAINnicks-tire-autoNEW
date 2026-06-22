"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Send, MessageSquare, Terminal, Search, Inbox, CheckCircle, Activity, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";

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
    <div className="fixed bottom-0 inset-x-0 z-30 pb-safe px-3 sm:px-6 pointer-events-none">
      <div className="mx-auto max-w-4xl w-full glass-card border-[var(--gold)]/20 bg-[#0A0A0A]/90 backdrop-blur-lg shadow-[var(--shadow-gold-strong)] pointer-events-auto p-2 sm:p-3 space-y-2 rounded-t-xl sm:rounded-xl">
        {/* Mode Selectors */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-[var(--border-default)] scrollbar-none">
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
                  "shrink-0 px-2.5 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider transition-colors inline-flex items-center gap-1.5 min-h-[36px]",
                  isActive
                    ? "bg-[var(--gold)]/10 text-[var(--gold)] border border-[var(--gold)]/30"
                    : "text-[var(--text-tertiary)] border border-transparent hover:text-[var(--text-secondary)]"
                )}
              >
                <Icon size={12} className={cn(isActive && "text-[var(--gold)]")} />
                {mode.label}
              </button>
            );
          })}
        </div>

        {/* Input Textarea & Send button */}
        <div className="flex items-end gap-2 pt-1">
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={currentMode.placeholder}
            rows={1}
            className={cn(
              "flex-1 min-h-[44px] resize-none bg-transparent px-3 py-2.5 text-[15px] sm:text-[16px] leading-snug",
              "text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]/50",
              "focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:outline-none"
            )}
          />

          <div className="flex items-center gap-1">
            <span className="hidden sm:inline text-[9px] font-mono text-[var(--text-tertiary)]/30 select-none mr-2">
              ⌘↵ to send
            </span>
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              aria-label="send message"
              className={cn(
                "shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-md transition-all active:scale-95",
                canSend
                  ? "bg-[var(--gold)] text-[var(--text-inverse)] hover:bg-[var(--gold-dim)]"
                  : "bg-[var(--border-default)] text-[var(--text-tertiary)]/30"
              )}
            >
              <Send size={16} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
