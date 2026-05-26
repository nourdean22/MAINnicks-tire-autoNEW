"use client";

/**
 * useMissionMode · Mastery Layer Stage D · 2026-05-26
 *
 * Reads `?missionId=X` from the URL and resolves to the mission row
 * via the existing `trpc.task.missions` query. Returns `{ active,
 * missionId, mission, exit() }`.
 *
 * The first system-wide contract for mission-mode. Any page that
 * wants to participate adds two lines:
 *   const { active, mission, exit } = useMissionMode();
 *   ... <MissionBreadcrumb /> at the top
 * and threads `missionId` into its data fetch. /tasks already has
 * the per-page filter wiring (since the redesign plan's Phase 9 was
 * /tasks-specific). Other pages adopt the contract progressively.
 *
 * Cost model · the trpc query is `enabled: !!missionId` so non-mission
 * pages pay zero extra network. Mission-mode pages get one extra
 * read of the missions list (already cached if the operator came
 * from /goals).
 */

import { useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { trpc } from "@/lib/trpc/client";

export interface MissionModeState {
  /** True when ?missionId is present in the URL. */
  active: boolean;
  /** The missionId from the URL · null when not in mission-mode. */
  missionId: string | null;
  /** The full mission row · null while loading OR when not in mode. */
  mission: { id: string; title: string; domain?: string; priority?: number; openTaskCount?: number } | null;
  /** Drop ?missionId from the URL · returns to the page's default view. */
  exit: () => void;
}

export function useMissionMode(): MissionModeState {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const missionId = searchParams?.get("missionId") ?? null;
  const active = missionId !== null;

  // Resolves to the mission row. `enabled: active` keeps this query
  // dormant when not in mission-mode · zero network cost in that case.
  // Reuses the existing canonical trpc.task.missions endpoint so the
  // mission catalog stays single-source-of-truth.
  const missionsQuery = trpc.task.missions.useQuery(undefined, {
    enabled: active,
    staleTime: 60_000,
  });

  const mission =
    active && missionsQuery.data
      ? missionsQuery.data.find((m: { id: string }) => m.id === missionId) ?? null
      : null;

  const exit = useCallback(() => {
    if (!active) return;
    // Drop ALL params · the inline filter banner today does the same.
    // If a future page wants to preserve OTHER query params on exit,
    // it can call its own router.push manually instead.
    router.push(pathname ?? "/");
  }, [active, router, pathname]);

  return { active, missionId, mission, exit };
}
