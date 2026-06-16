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
export type ChatMode = "standard" | "deep" | "quick";

interface NickHeaderV2Props {
  hasError?: boolean;
  isStreaming?: boolean;
  messageCount?: number;
  sessionStartTime?: number;
  historyOpen?: boolean;
  /** Retained for API compatibility but no longer renders. */
  personality?: ChatPersonality;
  onPersonalityChange?: (p: ChatPersonality) => void;
  /** Retained for API compatibility but no longer renders. */
  mode?: ChatMode;
  onModeChange?: (m: ChatMode) => void;
  ttsEnabled?: boolean;
  onToggleTTS?: () => void;
  wakeWordActive?: boolean;
  onToggleWakeWord?: () => void;
  /** v11.1 D2 · ambient / speaker mode toggle — composes wake-word +
   *  TTS + audio-ducking. Renders as a distinct row above the
   *  individual TTS / wake-word toggles. */
  ambientActive?: boolean;
  onToggleAmbient?: () => void;
  /** v10.0.529.58 · 2 NEW settings-tier toggles relocated to the
   *  ⋯ overflow menu per audit Wave 8 finding. Speed ribbon +
   *  provider override now visible from the menu so Nour doesn't
   *  need to memorize the Cmd+Shift+V shortcut. */
  showSpeedRibbon?: boolean;
  onToggleSpeedRibbon?: () => void;
  showConversationPulse?: boolean;
  onToggleConversationPulse?: () => void;
  providerOverride?: string;
  onCycleProvider?: () => void;
  onToggleHistory?: () => void;
  onNewChat?: () => void;
  onInspectPrompt?: () => void;
  /** Apr 20 — current conversation id so the overflow menu can expose
   *  the markdown/json export without sending Nour to Cmd+F first. */
  conversationId?: string | null;
  veniceHealthy?: boolean;
  // v10.0.529.59 · audit Wave 8 follow-up · conversationStarred /
  // Archived / Muted + onToggle* / onDeleteConversation REMOVED.
  // Those 4 low-frequency flag controls relocated to per-row actions
  // in ConversationDrawer (each row has Star · Mute · Archive ·
  // Delete next to Pin, Trash). 99% of sessions never touched these
  // from the header; identifying a convo by row is the natural
  // operator gesture anyway.
}

export function NickHeaderV2({
  hasError,
  isStreaming,
  messageCount = 0,
  sessionStartTime,
  historyOpen,
  personality,
  onPersonalityChange,
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
  onCycleProvider,
  onToggleHistory,
  onNewChat,
  onInspectPrompt,
  conversationId,
  veniceHealthy = true,
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

  // Status dot: red (error) · gold-pulse (streaming) · gold-idle · amber (no venice)
  const dotColor = hasError
    ? "bg-red-500"
    : isStreaming
      ? "bg-[var(--gold)] nick-orb-streaming"
      : !veniceHealthy
        ? "bg-amber-400"
        : "bg-[var(--gold)] nick-orb-idle";

  // Minutes since session start — shown tiny, only when >0.
  // Apr 27 · COMPILER-FIX — was Date.now() in render which the React
  // Compiler flags as impure (different value every render = no
  // memoization possible). Now ticks once a minute via a state set
  // by an interval — initial state is 0 (deterministic SSR), then
  // mounts and starts ticking. Same UX, no impurity in render.
  const [minutes, setMinutes] = useState(0);
  useEffect(() => {
    if (!sessionStartTime) return;
    const tick = () => setMinutes(Math.floor((Date.now() - sessionStartTime) / 60_000));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [sessionStartTime]);

  // Apr 27 · MOBILE-FLUIDITY — header height bumped on mobile so the
  // live dot + NICK label + chevron + minutes count have real space;
  // reverts to the tight 36px on desktop where the cursor is precise.
  return (
    <div className="flex items-center justify-between gap-2 px-3 h-11 sm:h-9 border-b border-[var(--border-default)]">
      {/* Left: NICK + live dot + chevron for history */}
      <button
        onClick={onToggleHistory}
        className="flex items-center gap-2 min-w-0 group"
        aria-label="Toggle conversation history"
      >
        <div className={cn("w-2 h-2 rounded-full shrink-0", dotColor)} />
        <span className="font-bold uppercase tracking-[0.18em] text-[13px] leading-none text-[var(--text-primary)]">
          NICK
        </span>
        <ChevronDown
          size={11}
          className={cn(
            "text-[var(--text-tertiary)] transition-transform",
            historyOpen && "rotate-180",
          )}
        />
        {messageCount > 0 && minutes > 0 && (
          <span className="text-[9px] font-mono text-[var(--text-tertiary)] tabular-nums">
            {messageCount}·{minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`}
          </span>
        )}
      </button>

      {/* v10.0.351 · LiveHudBar removed · its metrics now ride in the
          global ticker (TASKS/SCORE/AI$ as ops items). The center grows
          to fill the space the HUD used to occupy. */}
      <div className="flex-1" />

      {/* provider-health pill — silent when all green, surfaces when amber/red */}
      <ProviderHealthPill className="hidden sm:inline-flex" />

      {/* Right: overflow menu only */}
      <div className="relative shrink-0" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="w-9 h-9 sm:w-7 sm:h-7 rounded-md flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)] transition-colors active:scale-90"
          aria-label="Chat options"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal size={14} />
        </button>
        {menuOpen && (
          <div className="absolute top-full right-0 mt-1 w-56 rounded-lg border border-[var(--border-default)] bg-[var(--bg-void)] backdrop-blur-xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] overflow-hidden z-50">
            {/* Apr 21 · Persona picker restored. Auto-inference is
                still the default — server sets X-Persona header per
                turn and the client syncs. But Nour asked "where did
                the coder go?" when Builder mode was invisible. Having
                an explicit row lets him force BUILDER (which opens the
                BuilderSandbox deploy/repo panel on desktop), force
                FRIEND (warm tone, no metrics), or lock MASTER. Keeps
                auto-inference running when he doesn't touch it. */}
            {onPersonalityChange && (
              <>
                <div className="px-3 pt-2 pb-1 text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                  Mode
                </div>
                {([
                  { key: "master" as const, label: "Master", icon: Crown, desc: "operator + strategist" },
                  { key: "builder" as const, label: "Builder", icon: Terminal, desc: "code + deploy · opens sandbox" },
                  { key: "friend" as const, label: "Friend", icon: Heart, desc: "casual · no metrics" },
                ]).map(({ key, label, icon: Icon, desc }) => (
                  <button
                    key={key}
                    onClick={() => {
                      setMenuOpen(false);
                      onPersonalityChange(key);
                    }}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 text-[11px] hover:bg-[var(--bg-raised)] transition-colors",
                      personality === key ? "text-[var(--gold)]" : "text-[var(--text-primary)]"
                    )}
                  >
                    <Icon size={12} />
                    <div className="flex-1 text-left">
                      <div>{label}</div>
                      <div className="text-[9px] text-[var(--text-tertiary)]">{desc}</div>
                    </div>
                    {personality === key && <Check size={10} className="text-[var(--gold)]" />}
                  </button>
                ))}
                <div className="h-px bg-[var(--border-default)]/60 my-1" />
              </>
            )}

            {/* Actions */}
            <button
              onClick={() => {
                setMenuOpen(false);
                onNewChat?.();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)] transition-colors"
            >
              <Plus size={12} />
              New chat
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                onToggleHistory?.();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)] transition-colors"
            >
              <History size={12} />
              History
            </button>
            {onToggleTTS && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onToggleTTS();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)] transition-colors"
              >
                {ttsEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
                {ttsEnabled ? "Voice on" : "Voice off"}
              </button>
            )}
            {onToggleWakeWord && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onToggleWakeWord();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)] transition-colors"
              >
                {wakeWordActive ? <Mic size={12} /> : <MicOff size={12} />}
                {wakeWordActive ? "Wake word on" : "Wake word off"}
              </button>
            )}
            {/* v11.1 D2 · Ambient / speaker mode. Composes wake-word +
                TTS + audio-ducking for hands-free ops. */}
            {onToggleAmbient && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onToggleAmbient();
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-[11px] hover:bg-[var(--bg-raised)] transition-colors",
                  ambientActive ? "text-[var(--gold)]" : "text-[var(--text-primary)]",
                )}
              >
                <Radio size={12} className={ambientActive ? "animate-pulse" : ""} />
                <div className="flex-1 text-left">
                  <div>{ambientActive ? "Ambient mode on" : "Ambient mode off"}</div>
                  <div className="text-[9px] text-[var(--text-tertiary)]">
                    {ambientActive ? "phone on counter · hands-free" : "wake word + TTS + audio-duck"}
                  </div>
                </div>
                {ambientActive && <Check size={10} className="text-[var(--gold)]" />}
              </button>
            )}
            {/* v10.0.529.58 · Speed ribbon toggle · per-message TTFT
                timing under each reply · persists to localStorage via
                useChatSpeedRibbon. Surfaces a state that pre-this-commit
                only existed as a keyboard-shortcut-less hook. */}
            {onToggleSpeedRibbon && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onToggleSpeedRibbon();
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-[11px] hover:bg-[var(--bg-raised)] transition-colors",
                  showSpeedRibbon ? "text-[var(--gold)]" : "text-[var(--text-primary)]",
                )}
              >
                {showSpeedRibbon ? <Zap size={12} /> : <ZapOff size={12} />}
                <div className="flex-1 text-left">
                  <div>{showSpeedRibbon ? "Speed ribbon on" : "Speed ribbon off"}</div>
                  <div className="text-[9px] text-[var(--text-tertiary)]">
                    per-message token timing
                  </div>
                </div>
                {showSpeedRibbon && <Check size={10} className="text-[var(--gold)]" />}
              </button>
            )}
            {onToggleConversationPulse && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onToggleConversationPulse();
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-[11px] hover:bg-[var(--bg-raised)] transition-colors",
                  showConversationPulse ? "text-[var(--gold)]" : "text-[var(--text-primary)]",
                )}
              >
                {showConversationPulse ? <Zap size={12} /> : <ZapOff size={12} />}
                <div className="flex-1 text-left">
                  <div>{showConversationPulse ? "Telemetry bar on" : "Telemetry bar off"}</div>
                  <div className="text-[9px] text-[var(--text-tertiary)]">
                    sparkline + cost + latency
                  </div>
                </div>
                {showConversationPulse && <Check size={10} className="text-[var(--gold)]" />}
              </button>
            )}
            {/* v10.0.529.58 · Provider override cycle · mirrors the
                Cmd+Shift+V keyboard shortcut. Surfaces the active
                override inline so Nour sees it without keystrokes. */}
            {onCycleProvider && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onCycleProvider();
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-[11px] hover:bg-[var(--bg-raised)] transition-colors",
                  providerOverride && providerOverride !== "auto"
                    ? "text-[var(--gold)]"
                    : "text-[var(--text-primary)]",
                )}
              >
                <Shuffle size={12} />
                <div className="flex-1 text-left">
                  <div>
                    Provider{providerOverride && providerOverride !== "auto" ? `: ${providerOverride}` : ": auto"}
                  </div>
                  <div className="text-[9px] text-[var(--text-tertiary)]">
                    Cmd+Shift+V · auto → ollama → venice → openai
                  </div>
                </div>
                {providerOverride && providerOverride !== "auto" && (
                  <Check size={10} className="text-[var(--gold)]" />
                )}
              </button>
            )}
            {onInspectPrompt && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onInspectPrompt();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)] transition-colors"
              >
                <Eye size={12} />
                Inspect prompt
              </button>
            )}
            {conversationId && messageCount > 0 && (
              <>
                <div className="h-px bg-[var(--border-default)]/60 my-1" />
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    window.open(
                      `/api/chat/export/${conversationId}?format=md&include=all`,
                      "_blank"
                    );
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)] transition-colors"
                  title="Download this conversation as markdown"
                >
                  <Download size={12} />
                  Export as Markdown
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    window.open(
                      `/api/chat/export/${conversationId}?format=json&include=all`,
                      "_blank"
                    );
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)] transition-colors"
                  title="Download this conversation as JSON (raw + metadata)"
                >
                  <FileJson size={12} />
                  Export as JSON
                </button>
                {/* v10.0.529.59 · audit Wave 8 follow-up · Star /
                    Archive / Mute / Delete relocated to per-row actions
                    in ConversationDrawer. The header's overflow menu
                    is no longer the right home for conversation-level
                    actions — operators identify a conversation by its
                    row, not by switching to it and opening this menu. */}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
