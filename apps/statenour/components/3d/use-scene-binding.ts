"use client";

/**
 * useSceneBinding · v10.0.290 · pushes a typed variable map onto a
 * Spline `Application` instance, throttled so a chatty data source
 * can't flood the runtime with `setVariable` calls.
 *
 * Spline exposes `app.setVariable(name, value)` for any variable a
 * scene declares in the editor (see the per-scene variable lists in
 * docs/spline-scene-briefs.md). A per-surface wrapper reads its data
 * source, maps it to the variable shape its scene expects, and passes
 * the map here. The hook then ·
 *   · is null-safe — no-op while `app` is null (pre-load)
 *   · detects change via JSON.stringify (maps are tiny — 3-6 keys)
 *   · throttles to THROTTLE_MS: an in-window change is not dropped, it
 *     is deferred and flushed once the window elapses (trailing edge),
 *     so the scene always converges on the latest data
 *
 * The scene's idle animation runs at 60fps on its own; data-bound
 * variables only need to refresh when the underlying data changes.
 */
import { useEffect, useRef } from "react";
import type { SplineApplication } from "@/components/3d/spline-scene";

type SceneVariableValue = number | string | boolean;
export type SceneVariables = Record<string, SceneVariableValue>;

const THROTTLE_MS = 5_000;

export function useSceneBinding(
  app: SplineApplication | null,
  variables: SceneVariables,
) {
  const lastPushAt = useRef(0);
  const lastSerialized = useRef<string>("");

  useEffect(() => {
    if (!app) return;

    const next = JSON.stringify(variables);
    if (next === lastSerialized.current) return; // nothing changed

    const push = () => {
      for (const [key, value] of Object.entries(variables)) {
        try {
          app.setVariable(key, value);
        } catch {
          // best-effort — a variable name absent from the scene must
          // not crash the surface. Spline no-ops missing keys in
          // practice; the try/catch is belt-and-suspenders.
        }
      }
      lastPushAt.current = Date.now();
      lastSerialized.current = next;
    };

    const elapsed = Date.now() - lastPushAt.current;
    if (elapsed >= THROTTLE_MS) {
      push(); // window open — push immediately
      return;
    }

    // In-window change — defer to the trailing edge so the latest
    // value still lands. Cleanup cancels if `variables` changes again
    // before the timer fires (the next effect run reschedules).
    const timer = setTimeout(push, THROTTLE_MS - elapsed);
    return () => clearTimeout(timer);
  }, [app, variables]);
}
