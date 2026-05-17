"use client";

/**
 * FrameworkOrbit · v10.0.290 · 3D orbit visualization for the
 * /system/lens-stats surface.
 *
 * 52 small spheres orbit a central point · each represents a
 * strategic-frameworks lens (Pareto, OKRs, First-Principles, etc.).
 * Top-fired lenses are larger and gold; less-fired ones are smaller
 * and gray. Click → drilldown.
 *
 * Data binding · reads `/api/system/lens-stats` and pushes the top 3
 * firers' relative sizes plus the per-surface fallback rate so the
 * scene can react to telemetry health:
 *   · `topFirerSize` · 0-1, normalized fire count
 *   · `secondFirerSize` · 0-1
 *   · `thirdFirerSize` · 0-1
 *   · `fallbackRate` · 0-1, system-wide lens-fallback proportion
 *
 * Until the scene URL lands in scene-registry.ts, this wrapper renders
 * the SceneSkeleton in place, sitting above the existing top-frameworks
 * table.
 */
import { useEffect, useState } from "react";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { SCENE_URLS } from "@/components/3d/scene-registry";
import { SplineScene, type SplineApplication } from "@/components/3d/spline-scene";
import { useSceneBinding } from "@/components/3d/use-scene-binding";

interface LensStatsShape {
  topFrameworks?: Array<{ framework: string; fires: number }>;
  fallbackRate?: number;
}

interface FrameworkOrbitProps {
  className?: string;
}

export function FrameworkOrbit({ className }: FrameworkOrbitProps) {
  const [app, setApp] = useState<SplineApplication | null>(null);
  const [data, setData] = useState<LensStatsShape>({});

  useEffect(() => {
    let alive = true;
    authedFetch("/api/system/lens-stats", { method: "GET" })
      .then((r) => (r?.ok ? r.json() : null))
      .then((json) => {
        if (alive && json) setData(json as LensStatsShape);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const top = data.topFrameworks ?? [];
  const maxFires = top[0]?.fires ?? 1;
  const sizeFor = (i: number) =>
    top[i] ? Math.min(1, top[i].fires / Math.max(1, maxFires)) : 0;

  useSceneBinding(app, {
    topFirerSize: sizeFor(0),
    secondFirerSize: sizeFor(1),
    thirdFirerSize: sizeFor(2),
    fallbackRate: data.fallbackRate ?? 0,
  });

  return (
    <SplineScene
      url={SCENE_URLS.frameworkOrbit}
      slotLabel="frameworkOrbit"
      onLoad={setApp}
      className={className}
    />
  );
}
