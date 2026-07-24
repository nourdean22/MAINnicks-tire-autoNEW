/**
 * Shared admin hooks.
 */
import React from "react";

// ─── 2026-05-06 — useUrlFilter hook ────────────────────────
// Single source of truth for URL-persistent filter state across
// every admin list/grid. Replaces ~25 ad-hoc useState patterns
// for filters that were lost on reload.
//
// Design choices:
//   · Default values are NOT written to the URL (keeps URLs clean)
//   · Search inputs are debounced 300ms before writing to URL
//     (avoids one history entry per keystroke)
//   · Validator is optional but recommended for enum unions
//   · Multiple useUrlFilter calls in one component coexist via
//     unique `name` keys; replaceState batches them
//   · Initial render reads URL synchronously (no hydration flash)
//   · Returns [value, setValue, reset] tuple (reset = setValue(default))
//
// Usage:
//   const [filter, setFilter] = useUrlFilter("status", "all", {
//     validate: (v) => ["all","new","contacted","booked"].includes(v) ? v : null,
//   });
//   const [search, setSearch, resetSearch] = useUrlFilter("q", "", { debounce: true });

interface UseUrlFilterOptions<T> {
  /** Validator — return T if valid, null if invalid (uses default). */
  validate?: (raw: string) => T | null;
  /** If true, debounce URL writes by 300ms (for search inputs). */
  debounce?: boolean;
}

export function useUrlFilter<T extends string>(
  name: string,
  defaultValue: T,
  options: UseUrlFilterOptions<T> = {},
): [T, (next: T) => void, () => void] {
  const { validate, debounce = false } = options;

  const readUrlValue = React.useCallback((): T => {
    if (typeof window === "undefined") return defaultValue;
    const raw = new URLSearchParams(window.location.search).get(name);
    if (raw === null) return defaultValue;
    if (validate) {
      const v = validate(raw);
      return v === null ? defaultValue : v;
    }
    return raw as T;
  }, [name, defaultValue, validate]);

  const [value, setLocalValue] = React.useState<T>(readUrlValue);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const writeUrl = React.useCallback((next: T) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next === defaultValue || next === "" || next === undefined || next === null) {
      url.searchParams.delete(name);
    } else {
      url.searchParams.set(name, String(next));
    }
    window.history.replaceState({}, "", url.toString());
  }, [name, defaultValue]);

  const setValue = React.useCallback((next: T) => {
    setLocalValue(next);
    if (debounce) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => writeUrl(next), 300);
    } else {
      writeUrl(next);
    }
  }, [writeUrl, debounce]);

  const reset = React.useCallback(() => {
    setValue(defaultValue);
  }, [setValue, defaultValue]);

  // Cleanup debounce on unmount
  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ── Back/forward + deep-link sync (admin Wave 4) ──────────────────────
  // The hook read the URL exactly ONCE (the useState initializer) and never
  // listened again: browser Back changed the address bar while every filter
  // kept its old state — the URL said one thing, the screen another. This
  // hook owns ~25 filters and the inner tabs of Settings, Growth, Tires,
  // Voice and Customers, so ONE missing listener broke back/forward and
  // deep-link fidelity across five sections at once.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setLocalValue(readUrlValue());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [readUrlValue]);

  return [value, setValue, reset];
}
