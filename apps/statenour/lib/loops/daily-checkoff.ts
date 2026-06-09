/**
 * DAILY check-off detection (Wire 4).
 *
 * A DAILY habit is completed from /missions via updateTask with a patch of
 * { status: "WAITING", snoozedUntil, lastCompletedAt, streakCount } — it does
 * NOT transition to DONE, so it never hits updateTask's after==="DONE" credit
 * block. Result: DAILY habits showed a streak but earned ZERO stat XP. This
 * detector lets updateTask credit per-day stat XP on that path too.
 *
 * Signal = loopKind DAILY + a lastCompletedAt in the patch that genuinely
 * ADVANCES past the task's previous lastCompletedAt. `streakCount` is NOT a
 * usable signal (its Zod schema has .default(0), so it's always present).
 *
 * The advance check makes the "no XP when nothing actually happened" invariant
 * provable rather than incidental: an edit that re-sends the SAME (or an older)
 * lastCompletedAt — or omits it — never credits, regardless of UI behavior.
 * Per-day crediting is ALSO idempotent (creditTaskStats sourceKey), so two real
 * check-offs in one day still credit XP at most once.
 */

export function isDailyCheckoff(
  loopKind: string | null | undefined,
  patch: { lastCompletedAt?: Date | string | null },
  prevLastCompletedAt?: Date | string | null,
): boolean {
  if (loopKind !== "DAILY") return false;
  if (patch.lastCompletedAt == null) return false;
  // First-ever check-off (no prior timestamp) always counts.
  if (prevLastCompletedAt == null) return true;
  // Otherwise only a STRICT advance counts — an unchanged or older value (an
  // edit echoing the field) earns nothing.
  return new Date(patch.lastCompletedAt).getTime() > new Date(prevLastCompletedAt).getTime();
}
