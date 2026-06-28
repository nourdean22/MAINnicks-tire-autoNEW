"use client";

/**
 * settings-controls.tsx — shared settings-panel form primitives.
 *
 * `SegmentedSelect` and `Toggle` were defined byte-identically in both
 * ai-settings-panel.tsx and journal-brain-panel.tsx (2026-06-19 audit
 * dead-dup finding). Extracted here as the single source of truth. The
 * canonical version carries `type="button"` (prevents accidental form
 * submit), `aria-pressed`/`role="switch"` semantics, and `aria-hidden`
 * on the decorative toggle thumb. `Row` / `NumberInput` / `Stat` stay
 * local to each panel — those variants genuinely differ.
 */

import { cn } from "@/lib/utils";
import { haptic } from "@/lib/ui/haptic";

export function SegmentedSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-[var(--border-default)] p-0.5 bg-[var(--bg-elevated)]">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => {
            haptic.select();
            onChange(o);
          }}
          className={cn(
            "px-2 h-5 text-[9px] font-bold uppercase tracking-wider rounded transition-colors",
            value === o
              ? "bg-[var(--gold)]/20 text-[var(--gold)]"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={cn(
        "relative w-9 h-5 rounded-full border transition-colors",
        value
          ? "bg-[var(--gold)]/30 border-[var(--gold)]/50"
          : "bg-[var(--bg-elevated)] border-[var(--border-default)]",
      )}
      role="switch"
      aria-checked={value}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all",
          value ? "left-4.5 bg-[var(--gold)]" : "left-0.5 bg-[var(--text-tertiary)]",
        )}
      />
    </button>
  );
}
