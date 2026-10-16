/**
 * Distinguishes an initially unreadable board from a failed background refresh
 * when React Query still has a complete last-confirmed task and mission view.
 *
 * W2 (2026-10-16): a board with no data yet is "loading", never "ready". Keyed
 * on the ABSENCE of data, not on isLoading: in TanStack v5 isLoading is
 * isFetching && isPending, so a paused (offline) or idle first load has no data
 * and no isLoading either, and would have read "ready" with an empty list (the
 * false "no active missions"). An errored read with nothing cached is unreadable.
 */
export function missionBoardReadState(input: {
  tasksData: unknown;
  missionsData: unknown;
  tasksErrored: boolean;
  missionsErrored: boolean;
}): "loading" | "ready" | "stale" | "unreadable" {
  const hasCompleteCachedBoard =
    input.tasksData !== undefined && input.missionsData !== undefined;

  if (!input.tasksErrored && !input.missionsErrored) {
    return hasCompleteCachedBoard ? "ready" : "loading";
  }

  return hasCompleteCachedBoard ? "stale" : "unreadable";
}
