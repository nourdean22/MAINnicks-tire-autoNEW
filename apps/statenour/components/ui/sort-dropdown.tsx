"use client";

/**
 * components/ui/sort-dropdown.tsx · v10.0.436
 *
 * Shared sort-control component · canonical pattern for every
 * list-heavy operator surface.
 *
 * Usage:
 *
 *   <SortDropdown
 *     value={sortKey}
 *     onChange={setSortKey}
 *     options={[
 *       { value: "newest",  label: "newest first" },
 *       { value: "oldest",  label: "oldest first" },
 *       { value: "alpha-asc", label: "alpha · A→Z" },
 *     ]}
 *     storageKey="journal:sortKey"   // optional · localStorage persist
 *     ariaLabel="Sort journal entries"
 *   />
 *
 * Replaces the inline <select> blocks across /system/skills, /tasks,
 * and /brain/wisdom (each had its own copy with the same Tailwind
 * + 44px mobile tap target). Centralizing means future tweaks (e.g.
 * keyboard shortcuts, a11y polish) propagate everywhere at once.
 */

import { useEffect } from "react";

export interface SortOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
  /** Tooltip · shown on hover. */
  hint?: string;
}

interface SortDropdownProps<T extends string = string> {
  value: T;
  onChange: (next: T) => void;
  options: SortOption<T>[];
  /** localStorage key · when set, the value persists across reloads. */
  storageKey?: string;
  /** Visual label shown next to the dropdown (hidden on mobile). */
  label?: string;
  /** ARIA label for screen readers. */
  ariaLabel?: string;
  /**
   * v10.0.442 · ux-audit · "visibility of system status" + "user control
   * and freedom". When set, displays a subtle indicator dot when the
   * current value differs from the default · gives the operator a
   * visual cue that they're viewing a non-default sort, with a built-in
   * "reset to default" affordance.
   */
  defaultValue?: T;
  className?: string;
}

export function SortDropdown<T extends string = string>({
  value,
  onChange,
  options,
  storageKey,
  label = "sort",
  ariaLabel = "Sort",
  defaultValue,
  className,
}: SortDropdownProps<T>) {
  // localStorage persistence · effect-driven so SSR doesn't break.
  useEffect(() => {
    if (!storageKey) return;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, value);
    } catch {
      /* swallow · localStorage may be disabled */
    }
  }, [storageKey, value]);

  const meta = options.find((o) => o.value === value);
  const isCustomized = defaultValue !== undefined && value !== defaultValue;

  return (
    <label className={`flex items-center gap-2 shrink-0 ${className ?? ""}`}>
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary hidden sm:inline">
        {label}
      </span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          aria-label={ariaLabel}
          title={meta?.hint}
          className={[
            "text-[13px] font-medium px-3 py-2 sm:px-2 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded-control border bg-content text-fg focus:outline-none cursor-pointer transition-colors duration-[var(--motion-state)]",
            // ux-audit · "visibility of system status" · accent border when customized (a selected state)
            isCustomized
              ? "border-accent pr-7"
              : "border-edge-default hover:border-edge-strong focus:border-accent",
          ].join(" ")}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        {/* ux-audit · "user control and freedom" · one-tap reset to default
            when value differs · only renders when defaultValue is provided */}
        {isCustomized && defaultValue !== undefined && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onChange(defaultValue);
            }}
            aria-label="Reset sort to default"
            title="Reset to default"
            className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-[12px] text-fg-tertiary hover:text-rose-400 rounded-micro hover:bg-rose-500/10"
          >
            ×
          </button>
        )}
      </div>
    </label>
  );
}

/**
 * Convenience hook · localStorage-backed sort state with default
 * value validation. Returns [value, setValue].
 *
 * Usage:
 *   const [sortKey, setSortKey] = useStoredSort<MySort>(
 *     "journal:sortKey",
 *     "newest",
 *     ["newest", "oldest", "alpha-asc"],
 *   );
 */
export function useStoredSort<T extends string>(
  storageKey: string,
  defaultValue: T,
  validValues: readonly T[],
): [T, (next: T) => void] {
  const [value, setValue] = useStoredState<T>(storageKey, defaultValue, validValues);
  return [value, setValue];
}

// ── helper · localStorage-backed useState with validation ────────

import { useState } from "react";

function useStoredState<T extends string>(
  key: string,
  defaultValue: T,
  validValues: readonly T[],
): [T, (next: T) => void] {
  const [value, setValueRaw] = useState<T>(() => {
    if (typeof window === "undefined") return defaultValue;
    try {
      const saved = window.localStorage.getItem(key);
      if (saved && validValues.includes(saved as T)) return saved as T;
    } catch {
      /* ignore */
    }
    return defaultValue;
  });
  function setValue(next: T) {
    setValueRaw(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(key, next);
      } catch {
        /* ignore */
      }
    }
  }
  return [value, setValue];
}
