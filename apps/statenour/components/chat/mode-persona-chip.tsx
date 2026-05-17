"use client";

/**
 * components/chat/mode-persona-chip.tsx · v10.0.413
 *
 * One-tap mode-persona switch for the chat composer.
 *
 * Cycles through 4 modes · default → battle → reflect → execute → default.
 * When mode is non-default, the composer auto-prepends the prefix on
 * send (`/battle X`, `/reflect X`, `/execute X`). The system prompt's
 * MODE_PERSONAS rule (v10.0.400, centralized in v10.0.404) then
 * activates the appropriate voice + word cap.
 *
 * Resets to "default" after every send · the operator must opt-in
 * each turn rather than getting stuck in battle voice for a session.
 *
 * Style · 32×32 button matching the other composer chrome (mic /
 * attach / audio) · color shifts subtly per mode so the operator can
 * see at a glance what voice the next send will use.
 */

import { Sword, Compass, Zap, Slash } from "lucide-react";

export type PersonaMode = "default" | "battle" | "reflect" | "execute";

const MODES: PersonaMode[] = ["default", "battle", "reflect", "execute"];

interface ModeMeta {
  icon: typeof Sword;
  label: string;
  hint: string;
  color: string;
  bg: string;
  border: string;
}

const MODE_META: Record<PersonaMode, ModeMeta> = {
  default: {
    icon: Slash,
    label: "default",
    hint: "Default voice · tap to cycle modes (battle / reflect / execute)",
    color: "text-[var(--text-tertiary)]",
    bg: "hover:bg-[var(--bg-elevated)]",
    border: "border-transparent",
  },
  battle: {
    icon: Sword,
    label: "battle",
    hint: "Battle mode · Greene + Musk · decisive · ≤60 words · tap to cycle",
    color: "text-rose-400",
    bg: "bg-rose-500/15 hover:bg-rose-500/25",
    border: "border-rose-500/40",
  },
  reflect: {
    icon: Compass,
    label: "reflect",
    hint: "Reflect mode · Satori + Buffett · exploratory · length OK · tap to cycle",
    color: "text-sky-300",
    bg: "bg-sky-500/15 hover:bg-sky-500/25",
    border: "border-sky-500/40",
  },
  execute: {
    icon: Zap,
    label: "execute",
    hint: "Execute mode · Jobs + Gates · numbered steps · ≤120 words · tap to cycle",
    color: "text-amber-300",
    bg: "bg-amber-500/15 hover:bg-amber-500/25",
    border: "border-amber-500/40",
  },
};

export function nextMode(current: PersonaMode): PersonaMode {
  const idx = MODES.indexOf(current);
  return MODES[(idx + 1) % MODES.length] ?? "default";
}

/**
 * Apply the current mode to a user message · prepends the slash
 * prefix when needed. If the operator already typed `/battle ...`
 * manually we skip the prepend to avoid double-prefixing.
 */
export function applyMode(text: string, mode: PersonaMode): string {
  if (mode === "default") return text;
  if (/^\/(battle|reflect|execute)\b/i.test(text)) return text;
  return `/${mode} ${text}`;
}

interface ModePersonaChipProps {
  mode: PersonaMode;
  onChange: (m: PersonaMode) => void;
  className?: string;
}

export function ModePersonaChip({ mode, onChange, className }: ModePersonaChipProps) {
  const meta = MODE_META[mode];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={() => {
        const next = nextMode(mode);
        onChange(next);
        // v10.0.415 · telemetry · only fire when entering a non-default mode
        if (next !== "default") {
          void fetch("/api/brain/telemetry", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ event: "mode_chip_cycle", tags: { mode: next } }),
          }).catch(() => null);
        }
      }}
      className={[
        // v10.0.419 · 44px on mobile (iOS HIG · was 40px) · 32px on desktop
        "shrink-0 w-11 h-11 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-all border active:scale-90",
        meta.color,
        meta.bg,
        meta.border,
        className ?? "",
      ].join(" ")}
      title={meta.hint}
      aria-label={`Mode: ${meta.label}. Tap to cycle.`}
    >
      <Icon size={14} />
    </button>
  );
}
