/**
 * DAILY check-off detection (Wire 4).
 *
 * A DAILY habit is completed from /missions via updateTask with a patch of
 * { status: "WAITING", snoozedUntil, lastCompletedAt, streakCount } — it does
 * NOT transition to DONE, so it never hits updateTask's after==="DONE" credit
 * block. Result: DAILY habits showed a streak but earned ZERO stat XP. This
 * detector lets updateTask credit per-day stat XP on that path too.
 *
 * Signal = loopKind DAILY + a lastCompletedAt in the patch. `streakCount` is
 * NOT a usable signal (its Zod schema has .default(0), so it's always present).
 * Per-day crediting is idempotent (creditTaskStats sourceKey), so even a rare
 * false positive credits at most once per day.
 */

export function isDailyCheckoff(
  loopKind: string | null | undefined,
  patch: { lastCompletedAt?: Date | string | null },
): boolean {
  return loopKind === "DAILY" && patch.lastCompletedAt != null;
}
