/**
 * Distinguishes an initially unreadable board from a failed background refresh
 * when React Query still has a complete last-confirmed task and mission view.
 *
 * W2 (2026-10-16): a read that has not answered yet is "loading", never
 * "ready". Before this the page handed MissionFeed an empty list during the
 * first fetch and the board said "no active missions" (empty-vs-error: a read
 * that never ran is UNMEASURED, not zero). An errored read is never loading.
 */
export function missionBoardReadState(input: {
  tasksData: unknown;
  missionsData: unknown;
  tasksErrored: boolean;
  missionsErrored: boolean;
  tasksLoading?: boolean;
  missionsLoading?: boolean;
}): "loading" | "ready" | "stale" | "unreadable" {
  const hasCompleteCachedBoard =
    input.tasksData !== undefined && input.missionsData !== undefined;

  if (!input.tasksErrored && !input.missionsErrored) {
    if (hasCompleteCachedBoard) return "ready";
    return input.tasksLoading || input.missionsLoading ? "loading" : "ready";
  }

  return hasCompleteCachedBoard ? "stale" : "unreadable";
}
