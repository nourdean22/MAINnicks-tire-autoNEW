/**
 * Distinguishes an initially unreadable board from a failed background refresh
 * when React Query still has a complete last-confirmed task and mission view.
 */
export function missionBoardReadState(input: {
  tasksData: unknown;
  missionsData: unknown;
  tasksErrored: boolean;
  missionsErrored: boolean;
}): "ready" | "stale" | "unreadable" {
  if (!input.tasksErrored && !input.missionsErrored) return "ready";

  const hasCompleteCachedBoard =
    input.tasksData !== undefined && input.missionsData !== undefined;
  return hasCompleteCachedBoard ? "stale" : "unreadable";
}
