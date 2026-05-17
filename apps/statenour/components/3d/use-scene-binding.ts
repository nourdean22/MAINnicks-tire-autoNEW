"use client";

/**
 * useSceneBinding · v10.0.290 · pushes a typed variable map onto a
 * Spline Application instance, throttled to avoid excess
 * `setVariable` calls.
 *
 * The Spline runtime exposes `app.setVariable(name, value)` for any
 * variable a scene declares in the editor. The per-surface wrapper
 * reads its data source (e.g. system health), maps to the variable
 * shape its scene expects, and passes the map here. The hook handles ·
 *   · null-safe (no-op while the app ref is null / pre-load)
 *   · throttled · only pushes when ≥ THROTTLE_MS has passed since the
 *     last push, OR when a value changed
 *   · per-key change detection via JSON.stringify (cheap; the maps
 *     are tiny · 3-6 numeric/string keys)
 *
 * Idle Spline animation runs at 60fps on its own · we only need to
 * push data when it actually changes. Throttle keeps this conservative
 * even if the data source ticks more often.
 */
import { useEffect, useRef } from "react";
import type { SplineApplication } from "@/components/3d/spline-scene";

type SceneVariableValue = number | string | boolean;
type SceneVariables = Record<string, SceneVariableValue>;

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
    if (next === lastSerialized.current) return;

    const now = Date.now();
    if (now - lastPushAt.current < THROTTLE_MS) return;

    for (const [key, value] of Object.entries(variables)) {
      try {
        app.setVariable(key, value);
      } catch {
        // best-effort · a missing variable name in the scene shouldn't
        // crash the surface. Spline silently no-ops missing keys in
        // practice but we belt-and-suspender the try/catch anyway.
      }
    }
    lastPushAt.current = now;
    lastSerialized.current = next;
  }, [app, variables]);
}
