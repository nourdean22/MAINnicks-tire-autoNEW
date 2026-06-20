"use client";

/**
 * NickHeader v2 — Tesla-grade minimum. Apr 19.
 *
 * Was: NICK + chevron + revenue + drift count + Venice dot + mute +
 *       wake word + plus button = 8 elements in a 44px row
 *
 * Now: NICK + status dot + overflow (⋯). 3 elements in 32px.
 * Everything else moved to the overflow menu or deleted.
 *
 * Revenue + drift numbers retired from the chat header — they live
 * on the HQ ticker where they belong. Chat is a conversation
 * surface, not a stats dashboard.
 *
 * The overflow menu hides: new chat, history, persona picker (Master/
 * Builder/Friend), mode (auto/deep/quick), TTS toggle, wake word
 * toggle, provider pill, prompt inspector. 99% of sessions Nour
 * doesn't touch any of these.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  MoreHorizontal,
  Plus,
  History,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  Eye,
  ChevronDown,
  Download,
  FileJson,
  Terminal,
  Heart,
  Crown,
  Check,
  Radio,
  // v10.0.529.58 · 3 icons for the 2 new ⋯ menu rows
  // (speed-ribbon toggle · provider override cycle).
  Zap,
  ZapOff,
  Shuffle,
  // v10.0.529.59 · audit Wave 8 follow-up · Star / Archive / BellOff /
  // Trash2 removed from imports — those 4 controls relocated from the
  // header overflow menu to per-row actions in ConversationDrawer.
  Brain,
} from "lucide-react";
import { ProviderHealthPill } from "@/components/chat/provider-health-pill";
// v10.0.351 · LiveHudBar retired · its metrics (tasks/score/cost)
// folded into /api/ultron/ticker as ops items so they ride in the
// existing global ticker. Single awareness surface · no duplicate
// 30s-vs-5min poll. Revenue + leads were already in the shop pulse,
// so no migration needed for those.

// Apr 19 · Persona + Mode picker props kept in the interface so the
// chat page can still pass them, but they're no longer rendered.
// Nick infers both per-turn automatically. Programmatic override
// still works via lib/ai/intent-classifier.ts setPersonaOverride().
export type ChatPersonality = "master" | "builder" | "friend";
export type ChatMode = "auto" | "standard" | "deep";
export type ProviderOverride = "auto" | "ollama" | "gemini" | "openai" | "anthropic";

interface NickHeaderV2Props {
  hasError?: boolean;
  isStreaming?: boolean;
  messageCount?: number;
  sessionStartTime?: number;
  historyOpen?: boolean;
  personality?: ChatPersonality;
  onPersonalityChange?: (p: ChatPersonality) => void;
  mode?: ChatMode;
  onModeChange?: (m: ChatMode) => void;
  ttsEnabled?: boolean;
  onToggleTTS?: () => void;
  wakeWordActive?: boolean;
  onToggleWakeWord?: () => void;
  ambientActive?: boolean;
  onToggleAmbient?: () => void;
  showSpeedRibbon?: boolean;
  onToggleSpeedRibbon?: () => void;
  showConversationPulse?: boolean;
  onToggleConversationPulse?: () => void;
  providerOverride?: string;
  onProviderChange?: (p: ProviderOverride) => void;
  onCycleProvider?: () => void;
  onToggleHistory?: () => void;
  onNewChat?: () => void;
  onInspectPrompt?: () => void;
  memoryInspectorOpen?: boolean;
  onToggleMemoryInspector?: () => void;
  conversationId?: string | null;
  providerHealthy?: boolean;
}

export function NickHeaderV2({
  hasError,
  isStreaming,
  messageCount = 0,
  sessionStartTime,
  historyOpen,
  personality,
  onPersonalityChange,
  mode = "auto",
  onModeChange,
  ttsEnabled,
  onToggleTTS,
  wakeWordActive,
  onToggleWakeWord,
  ambientActive,
  onToggleAmbient,
  showSpeedRibbon,
  onToggleSpeedRibbon,
  showConversationPulse,
  onToggleConversationPulse,
  providerOverride,
  onProviderChange,
  onCycleProvider,
  onToggleHistory,
  onNewChat,
  onInspectPrompt,
  memoryInspectorOpen,
  onToggleMemoryInspector,
  conversationId,
  providerHealthy = true,
}: NickHeaderV2Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  // Status dot: red (error) · gold-pulse (streaming) · gold-idle · amber (provider degraded)
  const dotColor = hasError
    ? "bg-red-500"
    : isStreaming
      ? "bg-(--gold) nick-orb-streaming"
      : !providerHealthy
        ? "bg-amber-400"
        : "bg-(--gold) nick-orb-idle";

  // Minutes since session start — shown tiny, only when >0.
  const [minutes, setMinutes] = useState(0);
  useEffect(() => {
    if (!sessionStartTime) return;
    const tick = () => setMinutes(Math.floor((Date.now() - sessionStartTime) / 60_000));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [sessionStartTime]);

  return (
    <div className="flex items-center justify-between gap-2 px-3 h-11 sm:h-9 border-b border-(--border-default)">
      {/* Left: NICK + live dot + chevron for history */}
      <button
        onClick={onToggleHistory}
        className="flex items-center gap-2 min-w-0 group"
        aria-label="Toggle conversation history"
      >
        <div className={cn("w-2 h-2 rounded-full shrink-0", dotColor)} />
        <span className="font-bold uppercase tracking-[0.18em] text-[13px] leading-none text-(--text-primary)">
          NICK
        </span>
        <ChevronDown
          size={11}
          className={cn(
            "text-(--text-tertiary) transition-transform",
            historyOpen && "rotate-180",
          )}
        />
        {messageCount > 0 && minutes > 0 && (
          <span className="text-[9px] font-mono text-(--text-tertiary) tabular-nums">
            {messageCount}·{minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`}
          </span>
        )}
      </button>

      <div className="flex-1" />

      <ProviderHealthPill className="hidden sm:inline-flex" />

      {/* Right: overflow menu only */}
      <div className="relative shrink-0" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="w-9 h-9 sm:w-7 sm:h-7 rounded-md flex items-center justify-center text-(--text-tertiary) hover:text-(--text-primary) hover:bg-(--bg-raised) transition-colors active:scale-95"
          aria-label="Chat options"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal size={14} />
        </button>
        {menuOpen && (
          <div className="absolute top-full right-0 mt-2 w-80 max-h-[85vh] overflow-y-auto rounded-xl border border-white/10 bg-neutral-950/90 backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.75)] p-4 flex flex-col gap-4 z-50 text-white transition-all duration-200 animate-in fade-in slide-in-from-top-2">
            
            {/* 1. Persona Selector */}
            {onPersonalityChange && (
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 mb-2 flex items-center justify-between">
                  <span>Persona</span>
                  <span className="text-[9px] text-(--gold) font-semibold uppercase">
                    {personality}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1 bg-white/5 p-1 rounded-lg">
                  {(["master", "builder", "friend"] as const).map((p) => {
                    const isActive = personality === p;
                    return (
                      <button
                        key={p}
                        onClick={() => {
                          onPersonalityChange(p);
                        }}
                        className={cn(
                          "h-9 rounded-md text-xs font-medium transition-all duration-150 active:scale-95 capitalize",
                          isActive
                            ? "bg-(--gold) text-black font-semibold shadow-sm"
                            : "text-neutral-400 hover:text-white hover:bg-white/5"
                        )}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
                <div className="text-[9px] text-neutral-400 mt-1.5 px-1 min-h-[12px]">
                  {personality === "master" && "Operator & strategist mode — terse and actionable."}
                  {personality === "builder" && "Technical coding mode — opens repository sandboxes."}
                  {personality === "friend" && "Casual, supportive conversational companion."}
                </div>
              </div>
            )}

            {/* 2. Routing Mode Selector */}
            {onModeChange && (
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 mb-2 flex items-center justify-between">
                  <span>Routing Mode</span>
                  <span className="text-[9px] text-(--gold) font-semibold uppercase">
                    {mode}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1 bg-white/5 p-1 rounded-lg">
                  {(["auto", "standard", "deep"] as const).map((m) => {
                    const isActive = mode === m;
                    return (
                      <button
                        key={m}
                        onClick={() => {
                          onModeChange(m);
                        }}
                        className={cn(
                          "h-9 rounded-md text-xs font-medium transition-all duration-150 active:scale-95 capitalize",
                          isActive
                            ? "bg-(--gold) text-black font-semibold shadow-sm"
                            : "text-neutral-400 hover:text-white hover:bg-white/5"
                        )}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 3. Provider Override Selector */}
            {onProviderChange && (
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 mb-2 flex items-center justify-between">
                  <span>Provider Override</span>
                  <span className="text-[9px] text-(--gold) font-semibold uppercase">
                    {providerOverride || "auto"}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="grid grid-cols-3 gap-1 bg-white/5 p-1 rounded-lg">
                    {(["auto", "ollama", "gemini"] as const).map((p) => {
                      const isActive = (providerOverride || "auto") === p;
                      return (
                        <button
                          key={p}
                          onClick={() => {
                            onProviderChange(p);
                          }}
                          className={cn(
                            "h-9 rounded-md text-[11px] font-medium transition-all duration-150 active:scale-95 capitalize",
                            isActive
                              ? "bg-(--gold) text-black font-semibold shadow-sm"
                              : "text-neutral-400 hover:text-white hover:bg-white/5"
                          )}
                        >
                          {p === "ollama" ? "Ollama" : p === "gemini" ? "Gemini" : p}
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-1 bg-white/5 p-1 rounded-lg">
                    {(["openai", "anthropic"] as const).map((p) => {
                      const isActive = (providerOverride || "auto") === p;
                      return (
                        <button
                          key={p}
                          onClick={() => {
                            onProviderChange(p);
                          }}
                          className={cn(
                            "h-9 rounded-md text-[11px] font-medium transition-all duration-150 active:scale-95 capitalize",
                            isActive
                              ? "bg-(--gold) text-black font-semibold shadow-sm"
                              : "text-neutral-400 hover:text-white hover:bg-white/5"
                          )}
                        >
                          {p === "openai" ? "OpenAI" : p === "anthropic" ? "Claude" : p}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <div className="h-px bg-white/10" />

            {/* 4. Ambient / Voice Toggle */}
            {onToggleAmbient && (
              <button
                onClick={onToggleAmbient}
                className={cn(
                  "h-11 w-full rounded-lg border flex items-center gap-3 px-3 transition-all duration-150 active:scale-95",
                  ambientActive
                    ? "border-(--gold)/30 bg-(--gold)/10 text-(--gold)"
                    : "border-white/5 bg-white/5 text-neutral-300 hover:bg-white/10 hover:text-white"
                )}
              >
                <Radio size={14} className={cn(ambientActive && "animate-pulse")} />
                <div className="flex-1 text-left">
                  <div className="text-[11px] font-medium">Ambient Hands-Free</div>
                  <div className="text-[8px] text-neutral-400 leading-tight">
                    Wake word + speech output + phone counter mode
                  </div>
                </div>
                {ambientActive && <Check size={10} className="text-(--gold)" />}
              </button>
            )}

            {/* 5. Toggles Grid */}
            <div className="grid grid-cols-2 gap-2">
              {onToggleTTS && (
                <button
                  onClick={onToggleTTS}
                  className={cn(
                    "h-11 rounded-lg border flex items-center gap-2.5 px-3 transition-all duration-150 active:scale-95 text-[11px] font-medium",
                    ttsEnabled
                      ? "border-(--gold)/30 bg-(--gold)/5 text-(--gold)"
                      : "border-white/5 bg-white/5 text-neutral-300 hover:bg-white/10 hover:text-white"
                  )}
                >
                  {ttsEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
                  Voice Out
                </button>
              )}
              {onToggleWakeWord && (
                <button
                  onClick={onToggleWakeWord}
                  className={cn(
                    "h-11 rounded-lg border flex items-center gap-2.5 px-3 transition-all duration-150 active:scale-95 text-[11px] font-medium",
                    wakeWordActive
                      ? "border-(--gold)/30 bg-(--gold)/5 text-(--gold)"
                      : "border-white/5 bg-white/5 text-neutral-300 hover:bg-white/10 hover:text-white"
                  )}
                >
                  {wakeWordActive ? <Mic size={13} /> : <MicOff size={13} />}
                  Wake Word
                </button>
              )}
              {onToggleSpeedRibbon && (
                <button
                  onClick={onToggleSpeedRibbon}
                  className={cn(
                    "h-11 rounded-lg border flex items-center gap-2.5 px-3 transition-all duration-150 active:scale-95 text-[11px] font-medium",
                    showSpeedRibbon
                      ? "border-(--gold)/30 bg-(--gold)/5 text-(--gold)"
                      : "border-white/5 bg-white/5 text-neutral-300 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <Zap size={13} />
                  Speed Ribbon
                </button>
              )}
              {onToggleConversationPulse && (
                <button
                  onClick={onToggleConversationPulse}
                  className={cn(
                    "h-11 rounded-lg border flex items-center gap-2.5 px-3 transition-all duration-150 active:scale-95 text-[11px] font-medium",
                    showConversationPulse
                      ? "border-(--gold)/30 bg-(--gold)/5 text-(--gold)"
                      : "border-white/5 bg-white/5 text-neutral-300 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <Radio size={13} />
                  Telemetry Bar
                </button>
              )}
            </div>

            {/* 6. Inspectors Grid */}
            <div className="grid grid-cols-2 gap-2">
              {onInspectPrompt && (
                <button
                  onClick={onInspectPrompt}
                  className="h-11 rounded-lg border border-white/5 bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white flex items-center justify-center gap-2 text-[11px] font-medium active:scale-95 transition-all"
                >
                  <Eye size={13} />
                  Inspect Prompt
                </button>
              )}
              {onToggleMemoryInspector && (
                <button
                  onClick={onToggleMemoryInspector}
                  className={cn(
                    "h-11 rounded-lg border flex items-center justify-center gap-2 text-[11px] font-medium active:scale-95 transition-all",
                    memoryInspectorOpen
                      ? "border-(--gold)/30 bg-(--gold)/5 text-(--gold)"
                      : "border-white/5 bg-white/5 text-neutral-300 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <Brain size={13} />
                  Memory Ins.
                </button>
              )}
            </div>

            <div className="h-px bg-white/10" />

            {/* 7. Action Buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onNewChat?.();
                }}
                className="h-11 rounded-lg bg-(--gold) hover:opacity-95 text-black flex items-center justify-center gap-2 text-[11px] font-semibold active:scale-95 transition-all"
              >
                <Plus size={13} />
                New Chat
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onToggleHistory?.();
                }}
                className="h-11 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white flex items-center justify-center gap-2 text-[11px] font-medium active:scale-95 transition-all"
              >
                <History size={13} />
                History
              </button>
            </div>

            {/* 8. Export Buttons */}
            {conversationId && messageCount > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    window.open(
                      `/api/chat/export/${conversationId}?format=md&include=all`,
                      "_blank"
                    );
                  }}
                  className="h-11 rounded-lg border border-white/5 bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white flex items-center justify-center gap-2 text-[11px] font-medium active:scale-95 transition-all"
                >
                  <Download size={13} />
                  Markdown
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    window.open(
                      `/api/chat/export/${conversationId}?format=json&include=all`,
                      "_blank"
                    );
                  }}
                  className="h-11 rounded-lg border border-white/5 bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white flex items-center justify-center gap-2 text-[11px] font-medium active:scale-95 transition-all"
                >
                  <FileJson size={13} />
                  JSON Raw
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
