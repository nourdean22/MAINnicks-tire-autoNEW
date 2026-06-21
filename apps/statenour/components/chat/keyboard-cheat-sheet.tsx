"use client";

import { X } from "lucide-react";

/**
 * KeyboardCheatSheet — the Cmd+/ help modal listing keyboard shortcuts.
 *
 * Extracted from app/(mastery)/chat/page.tsx (Wave 83) as the JSX was
 * a self-contained overlay with zero parent state dependencies beyond
 * the open/close toggle. The shortcut list lived as a static array
 * inline · no per-render computation. Moving it out cuts ~70 LOC of
 * scroll noise from the page render tree without changing a single
 * visible pixel.
 */
type ShortcutRow = {
  keys: string[];
  desc: string;
};

const SHORTCUT_ROWS: ShortcutRow[] = [
  { keys: ["Enter"], desc: "Send message" },
  { keys: ["Shift", "Enter"], desc: "New line in draft" },
  { keys: ["↑"], desc: "Recall last message (when input is empty)" },
  { keys: ["⌘", "K"], desc: "Focus input from anywhere" },
  { keys: ["⌘", "/"], desc: "Toggle this cheat sheet" },
  { keys: ["⌘", "F"], desc: "Search chat history" },
  { keys: ["⌘", "I"], desc: "Inspect the system prompt Nick is using" },
  { keys: ["⌘", "⇧", "L"], desc: "Open tool-call log for this conversation" },
  { keys: ["⌘", "⇧", "D"], desc: "Force DEEP mode for next message" },
  { keys: ["⌘", "⇧", "V"], desc: "Cycle provider (auto → openai → anthropic)" },
  { keys: ["⌘", "⇧", "P"], desc: "Jump to /brain pinned-context manager" },
  { keys: ["⌘", "⇧", "T"], desc: "Toggle text-to-speech for Nick" },
  { keys: ["⌘", "⇧", "E"], desc: "Copy entire conversation to clipboard" },
  { keys: ["Esc"], desc: "Stop generating · close overlays · clear errors" },
  { keys: ["/"], desc: "Open slash command menu" },
];

export function KeyboardCheatSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center bg-[var(--bg-void)]/85 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-md w-full rounded-2xl border border-[var(--gold)]/30 bg-[var(--bg-void)] shadow-[0_20px_60px_rgba(0,0,0,0.6),0_0_40px_rgba(253,185,19,0.15)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-[var(--border-default)] flex items-center justify-between">
          <span className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.2em] text-[var(--gold)]">
            Keyboard Shortcuts
          </span>
          <button
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            title="Close (Esc)"
          >
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-1.5 text-[12px]">
          {SHORTCUT_ROWS.map((row, i) => (
            <div key={i} className="flex items-center gap-3 py-1">
              <div className="flex gap-1 shrink-0 w-[120px]">
                {row.keys.map((k) => (
                  <kbd
                    key={k}
                    className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[10px] font-mono text-[var(--text-primary)]"
                  >
                    {k}
                  </kbd>
                ))}
              </div>
              <span className="text-[var(--text-secondary)]">{row.desc}</span>
            </div>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-[var(--border-default)] text-[9px] text-[var(--text-tertiary)] font-mono uppercase tracking-wider flex justify-end">
          {/* v10.0.529.xx · "Hover a message for Copy · Regenerate
              · Pin" line removed. iPhone-first surface · hover doesn't
              exist on the primary device · long-press already triggers
              the MessageActionSheet. */}
          <span>Press Esc to close</span>
        </div>
      </div>
    </div>
  );
}
