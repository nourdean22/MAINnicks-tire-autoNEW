"use client";

/**
 * useOncePerSession · v10.0.529.18
 *
 * Fires `fn` at most once per browser session (sessionStorage-gated)
 * the first time `condition` returns true. Common shape for auto-
 * triggers that should opportunistically run once when prerequisites
 * are met but never repeat — auto-backfill from PLAN to NOW, one-shot
 * onboarding nudges, etc.
 *
 * Semantics ·
 *   · The condition is evaluated on every render where dependencies
 *     change. If it returns false, nothing happens.
 *   · When it first returns true, the session key is set IMMEDIATELY
 *     (before `fn` runs) so a concurrent re-render can't trigger a
 *     duplicate call.
 *   · `fn` may be async. Errors are not caught here — the caller
 *     wraps in try/catch if it cares.
 *
 * Inputs ·
 *   key       — sessionStorage key. Pick a namespaced string so it
 *               can't collide with other one-shot triggers.
 *   condition — called with no args per effect tick. Return true to
 *               trigger. Return false to wait.
 *   fn        — invoked once when condition first returns true.
 *   deps      — React dependency array · re-evaluates condition when
 *               any element changes (typical: [tasks.length,
 *               projects.length]).
 *
 * Pre-extraction this shape was inlined twice in /tasks page.tsx
 * (auto-backfill from PLAN to NOW · the daily AI-tasks trigger uses
 * a different storage key reset cadence so it's not a fit here).
 */

import { useEffect } from "react";

export function useOncePerSession(
  key: string,
  condition: () => boolean,
  fn: () => void | Promise<void>,
  deps: React.DependencyList,
): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Already fired this session · noop.
    try {
      if (sessionStorage.getItem(key)) return;
    } catch {
      // sessionStorage can throw in private-mode iframes. Bail
      // silently — the once-per-session contract degrades to
      // once-per-mount in that edge case, which is acceptable.
    }

    if (!condition()) return;

    // Set BEFORE invoking · prevents a re-entrant tick (e.g. fn
    // mutates a state that's in the dep array) from re-firing.
    try {
      sessionStorage.setItem(key, "1");
    } catch {
      // See above · noop on failure.
    }

    void fn();
    // Intentional: caller-provided deps. The hook is generic so we
    // can't statically reason about exhaustiveness here.
  }, deps);
}
