/**
 * Stopping the task timer — one definition, because there are three ways to
 * finish a task and they did not agree.
 *
 * `startTask` stamps `Task.startedAt` and moves the row to DOING. Completion is
 * supposed to convert that into elapsed minutes on `actualMinutes` and clear
 * the stamp. Measured 2026-08-27, only one of the three completion paths did
 * the whole job:
 *
 *   lib/services/task-actions.ts  ONCE/PROMISE   adds the minutes, clears it
 *   lib/services/task-actions.ts  DAILY/WEEKLY   discards the minutes (`void
 *                                                timeBump`) AND leaves the
 *                                                stamp set — so the row goes
 *                                                back to READY still looking
 *                                                started, and the NEXT
 *                                                completion measures from the
 *                                                original start, days later
 *   lib/ai/agent-actions/task-actions.ts         never reads `startedAt` at
 *                                                all: press Start in the UI,
 *                                                then ask Nick to close it,
 *                                                and the elapsed time is
 *                                                silently dropped while the
 *                                                stamp stays set on a row that
 *                                                is now DONE
 *
 * A timer that only some finishers stop is worse than no timer: the data it
 * does produce is a biased sample of how the task happened to be closed, not
 * of how long the work took.
 *
 * WHY DAILY STILL DISCARDS. That is preserved deliberately, not fixed here.
 * `actualMinutes` is compared against a PER-INSTANCE effort estimate (M15 → 15
 * minutes). A recurring row is never re-created, so accumulating across every
 * repetition would grow without bound and read as an enormous overage. Whether
 * a recurring task should track per-instance time is a product decision, and
 * changing it silently would manufacture exactly the kind of confident wrong
 * number the rest of this wave removed. What IS fixed is the dangling stamp.
 */

/** What a completion must merge into its `prisma.task.update` data. */
export interface TimerStop {
  /** Minutes to ADD to `actualMinutes`, or null when there is nothing to add. */
  addMinutes: number | null;
  /** Always null — the timer is stopped whichever way the task was finished. */
  startedAt: null;
}

/**
 * Convert a running timer into minutes.
 *
 * `keepDuration: false` stops the clock without recording anything, for the
 * recurring case above. It still clears the stamp, which is the half that was
 * simply a bug.
 *
 * Returns `addMinutes: null` when the task was never started — NOT 0. Zero
 * would be indistinguishable from "started and finished within the same
 * minute", and `actualMinutes` already suffers from a NOT NULL default of 0
 * that makes an untimed row look measured (268 of 268 non-null, 0 above zero
 * when this was written).
 */
export function stopTimer(
  startedAt: Date | null | undefined,
  now: Date,
  opts: { keepDuration?: boolean } = {},
): TimerStop {
  const keep = opts.keepDuration !== false;
  if (!startedAt) return { addMinutes: null, startedAt: null };

  const deltaMs = now.getTime() - new Date(startedAt).getTime();
  if (!keep) return { addMinutes: null, startedAt: null };

  // A clock running backwards is a corrupt reading, not a zero-minute task.
  if (deltaMs < 0) return { addMinutes: null, startedAt: null };

  // Floor of 1: a task that was genuinely started and finished registers as
  // worked-on. Rounding to 0 would put it back in the "never timed" bucket.
  return { addMinutes: Math.max(1, Math.round(deltaMs / 60_000)), startedAt: null };
}

/**
 * The `actualMinutes` value to write, or `undefined` to leave the column
 * untouched. `undefined` matters: Prisma skips undefined keys, so an untimed
 * completion does not overwrite minutes banked by an earlier one.
 */
export function accumulate(current: number | null | undefined, stop: TimerStop): number | undefined {
  if (stop.addMinutes === null) return undefined;
  return (current ?? 0) + stop.addMinutes;
}
