import { useMemo } from "react";
import { trpc } from "@/lib/trpc/client";
import type { Project, Task } from "@/components/actions/shared";

/**
 * Execution Deck (2026-09-01): the page's data story is one server-composed
 * deck read plus the two raw lists the board's actions and filters need.
 *
 * Removed from the old five-poll setup, deliberately:
 *  · system.healthSummary — its read performed a bodyTracking UPSERT on
 *    every 30s poll (a write-on-read), and its only consumer here was a
 *    decorative "AUTONOMIC" chip that belongs on /system.
 *  · operator.characterSheet — fed a header LVL/XP pill that summed five
 *    per-domain levels (baseline floors included) into a number nothing
 *    read. /stats keeps the honest per-stat sheet.
 *  · task.byId(?taskId=) — fetched and discarded; no consumer ever read
 *    the result (deep links use #task-<id> anchors, not ?taskId=).
 * task.list also slows 15s → 30s: the deck carries the fresh-scored
 * ordering now, so the raw list only feeds actions/filters.
 */
export function useMissionsData() {
  const utils = trpc.useUtils();

  const deckQuery = trpc.task.deck.useQuery(undefined, {
    staleTime: 20_000,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });

  const tasksQuery = trpc.task.list.useQuery(
    {},
    {
      refetchInterval: 30_000,
      refetchOnWindowFocus: false,
    },
  );

  const missionsQuery = trpc.task.missions.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  const ccStateQuery = trpc.operator.commandCenterState.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const tasks = useMemo<Task[]>(
    () => (tasksQuery.data ?? []) as Task[],
    [tasksQuery.data],
  );

  const missions = useMemo<Project[]>(
    () => (missionsQuery.data ?? []) as Project[],
    [missionsQuery.data],
  );

  return {
    utils,
    deckQuery,
    tasksQuery,
    missionsQuery,
    ccStateQuery,
    tasks,
    missions,
  };
}
