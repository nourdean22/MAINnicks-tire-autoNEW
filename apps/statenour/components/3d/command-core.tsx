"use client";

/**
 * CommandCore · v10.0.290 · 3D ambient backdrop for the homepage Ultron
 * surface.
 *
 * Per the spline-3d-integration UI mandate ("modern, creative, visually
 * stunning · don't build safe / generic"), the homepage gets a rotating
 * geometric form (gold-edged, dark-core) that signals "this is your
 * operating system" without crowding the data overlay.
 *
 * Data binding · subscribes to `/api/ultron/situation` (the existing
 * meta-aggregator) and pushes:
 *   · `healthScore` · 0-100 derived from severity counts
 *   · `alertLevel` · "info" | "warn" | "critical"
 *   · `situationCount` · total active items (size pulse)
 *
 * Until the user exports a Spline scene and fills the
 * `commandCore` URL in scene-registry.ts, this wrapper renders the
 * SceneSkeleton (with the dev "scene pending" badge in development).
 */
import { useState } from "react";
import { useUltronFetch } from "@/lib/ultron/client-cache";
import { SCENE_URLS } from "@/components/3d/scene-registry";
import { SplineScene, type SplineApplication } from "@/components/3d/spline-scene";
import { useSceneBinding } from "@/components/3d/use-scene-binding";

interface SituationShape {
  payload?: {
    candidates?: Array<{ severity?: string }>;
  };
}

const SEVERITY_RANK: Record<string, number> = {
  win: 0,
  info: 1,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function deriveAlertLevel(items: Array<{ severity?: string }>): string {
  const top = items.reduce((max, item) => {
    const rank = SEVERITY_RANK[item.severity ?? "info"] ?? 1;
    return Math.max(max, rank);
  }, 0);
  if (top >= 4) return "critical";
  if (top >= 3) return "warn";
  return "info";
}

interface CommandCoreProps {
  className?: string;
}

export function CommandCore({ className }: CommandCoreProps) {
  const [app, setApp] = useState<SplineApplication | null>(null);
  const { data } = useUltronFetch<SituationShape>("/api/ultron/situation", {
    ttlMs: 120_000,
    pollMs: 120_000,
  });

  const candidates = data?.payload?.candidates ?? [];
  const situationCount = candidates.length;
  const alertLevel = deriveAlertLevel(candidates);
  // Health · 100 with no warns, drops fast as severity climbs.
  const warnCount = candidates.filter(
    (c) => (SEVERITY_RANK[c.severity ?? "info"] ?? 0) >= 2,
  ).length;
  const healthScore = Math.max(0, 100 - warnCount * 10);

  useSceneBinding(app, {
    healthScore,
    alertLevel,
    situationCount,
  });

  return (
    <SplineScene
      url={SCENE_URLS.commandCore}
      slotLabel="commandCore"
      onLoad={setApp}
      className={className}
    />
  );
}
