/**
 * The /missions line after a completion that finished a plan phase (round 1 P1-4). A failed spawn is said, never
 * silent: milestones 2..N do not appear until the spawn runs again.
 */
export function nextPhaseToast(
  r: { nextPhaseSpawned?: number; nextPhaseSpawnFailed?: string } | null | undefined,
): { kind: "success" | "error"; message: string } | null {
  if (r?.nextPhaseSpawnFailed) {
    return { kind: "error", message: `The next milestone's tasks were not created (${r.nextPhaseSpawnFailed}). Reopen and finish this task to retry.` };
  }
  const n = r?.nextPhaseSpawned ?? 0;
  return n > 0 ? { kind: "success", message: `Next milestone ready: ${n} new task${n === 1 ? "" : "s"}` } : null;
}
