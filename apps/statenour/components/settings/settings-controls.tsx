"use client";

/**
 * settings-controls.tsx: shared settings-panel form primitives.
 *
 * `SegmentedSelect` and `Toggle` were defined byte-identically in both
 * ai-settings-panel.tsx and journal-brain-panel.tsx (2026-06-19 audit
 * dead-dup finding). Extracted here as the single source of truth. The
 * canonical version carries `type="button"` (prevents accidental form
 * submit), `aria-pressed`/`role="switch"` semantics, and `aria-hidden`
 * on the decorative toggle thumb. `Row` / `NumberInput` / `Stat` stay
 * local to each panel: those variants genuinely differ.
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
    <div className="flex items-center gap-0.5 rounded-control border border-edge-default p-0.5 bg-surface-raised">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => {
            haptic.select();
            onChange(o);
          }}
          className={cn("min-h-11 min-w-11 px-2 text-[11px] font-medium rounded-micro transition-colors duration-[var(--motion-state)]",
            value === o
              ? "bg-accent-soft text-fg"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/** A switch: the 36 x 20 track sits in a 44 px hit area (tests/e2e/target-size.spec.ts measures the button). */
export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center"
      role="switch"
      aria-checked={value}
      aria-label={label}
    >
      <span
        aria-hidden
        className={cn(
          "relative block w-9 h-5 rounded-full border transition-colors",
          value ? "bg-accent border-accent" : "bg-surface-raised border-edge-default",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 w-3.5 h-3.5 rounded-full transition-[left,background-color]",
            value ? "left-4.5 bg-[var(--text-inverse)]" : "left-0.5 bg-fg-tertiary",
          )}
        />
      </span>
    </button>
  );
}
