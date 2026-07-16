"use client";

import type { SlashCommand } from "@/hooks/use-slash-commands";

export type SlashCommandAction = "new-chat" | "history" | "pin-last" | "diagnose";

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
  onPromptFill: (prompt: string) => void;
  onPromptFire: (prompt: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="max-h-[240px] overflow-y-auto border-b border-edge bg-raised">
      {filtered.map((command) => (
        <button
          key={command.cmd}
          type="button"
          onClick={() => {
            if (command.navigate) {
              onNavigate(command.navigate);
              return;
            }
            if (command.action) {
              onAction(command.action);
              return;
            }
            if (command.prompt.endsWith(": ")) onPromptFill(command.prompt);
            else onPromptFire(command.prompt);
            onClose();
          }}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-gold/5"
        >
          <span className="text-base" aria-hidden>{command.icon}</span>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-medium text-fg">{command.label}</span>
            <span className="ml-2 font-mono text-[10px] text-fg-tertiary">{command.cmd}</span>
          </div>
          {command.navigate && <span className="shrink-0 font-mono text-[8px] uppercase tracking-wider text-gold/60">nav</span>}
          {command.action && <span className="shrink-0 font-mono text-[8px] uppercase tracking-wider text-blue-400/70">action</span>}
        </button>
      ))}
    </div>
  );
}
