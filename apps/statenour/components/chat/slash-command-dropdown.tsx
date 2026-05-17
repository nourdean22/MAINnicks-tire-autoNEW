"use client";

import type { SlashCommand } from "@/hooks/use-slash-commands";

/**
 * SlashCommandDropdown — the menu row above the composer that appears
 * when the operator types `/` and the use-slash-commands hook reports
 * `show=true` with filtered matches.
 *
 * Extracted from app/(mastery)/chat/page.tsx (Wave 83) · ~85 LOC of
 * self-contained JSX with no per-render computation beyond mapping
 * `filtered`. All routing / action dispatch is delegated to the parent
 * via the `on*` callbacks so this stays pure presentation.
 */
export type SlashCommandAction =
  | "new-chat"
  | "history"
  | "pin-last"
  | "clear-chat"
  | "diagnose";

export function SlashCommandDropdown({
  filtered,
  onNavigate,
  onAction,
  onPromptFill,
  onPromptFire,
  onClose,
}: {
  filtered: SlashCommand[];
  onNavigate: (path: string) => void;
  onAction: (action: SlashCommandAction) => void;
  /** Prompt template ends with ": " — operator fills the rest. */
  onPromptFill: (prompt: string) => void;
  /** Complete prompt — fire immediately. */
  onPromptFire: (prompt: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="border-b border-[var(--border-default)] bg-[var(--bg-raised)] max-h-[240px] overflow-y-auto">
      {filtered.map((c) => (
        <button
          key={c.cmd}
          onClick={() => {
            // Navigation takes priority
            if (c.navigate) {
              onNavigate(c.navigate);
              return;
            }
            // Client actions
            if (c.action) {
              onAction(c.action as SlashCommandAction);
              return;
            }
            // Prompt templates
            const needsInput = c.prompt.endsWith(": ");
            if (needsInput) {
              onPromptFill(c.prompt);
            } else {
              onPromptFire(c.prompt);
            }
            onClose();
          }}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--gold-ghost)] transition-colors"
        >
          <span className="text-base">{c.icon}</span>
          <div className="flex-1 min-w-0">
            <span className="text-xs font-medium text-[var(--text-primary)]">{c.label}</span>
            <span className="text-[10px] text-[var(--text-tertiary)] ml-2 font-mono">{c.cmd}</span>
          </div>
          {/* Type indicator */}
          {c.navigate && (
            <span className="text-[8px] font-mono uppercase tracking-wider text-[var(--gold)]/60 shrink-0">
              → nav
            </span>
          )}
          {c.action && (
            <span className="text-[8px] font-mono uppercase tracking-wider text-blue-400/60 shrink-0">
              action
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
