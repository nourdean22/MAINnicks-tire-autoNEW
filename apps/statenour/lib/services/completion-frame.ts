/**
 * What a task's completion state should SAY, and which frame it is saying it in.
 *
 * THE COMPLAINT. The operator finished his workout and the board read `WAITING`.
 * Nothing displayed was false, which is why this is a lying surface rather than
 * a bug: `WAITING` is a correct answer to a question he was not asking.
 *
 * MEASURED, 2026-08-23, and it corrected the design twice.
 *
 *   1. `task_events` held 8 `completed` rows across 8 distinct tasks. Four were
 *      ONCE tasks now reading DONE. Four were DAILY tasks reading WAITING. The
 *      split is exactly recurring vs one-off — the same task can be "completed"
 *      in the event log and "waiting" in its status column, and both are true.
 *
 *   2. The WAITING four are NOT stranded, which was the first hypothesis. All
 *      four carry `snoozedUntil` seven hours out — tomorrow at 6am — set
 *      deliberately by the snooze pill. `checkTask` leaves a completed DAILY at
 *      READY ("so it reappears tomorrow"); only WEEKLY gets a snooze on
 *      completion. So the operator completed them AND snoozed them, and the row
 *      collapsed two facts into the less useful one.
 *
 * That second finding is why this returns a label built from BOTH facts rather
 * than replacing WAITING with "done today". "Done today, back at 6am" is the
 * whole truth; either half alone is a different lie.
 *
 * THE INVARIANT THIS EXISTS TO ENFORCE. Any surface showing completion state
 * must declare which frame it is in — lifetime event or current status. Two
 * surfaces disagreeing about whether a task is done is survivable; a reader
 * unable to tell which question is being answered is not. The frame is a
 * required field on the return type, so a caller cannot render a label without
 * one, and the canary fails on a label that carries no frame at all — which is
 * the condition today, not merely a hypothetical wrong one.
 */

export type CompletionFrame =
  /** Reading `Task.status` — where the task is in its lifecycle right now. */
  | "status"
  /** Reading completion history — whether it was done, regardless of state now. */
  | "event"
  /** Both, because for a recurring task either alone misleads. */
  | "both";

export interface CompletionDisplay {
  /** What the operator reads. */
  label: string;
  /** Which question this label answers. Required — see the header. */
  frame: CompletionFrame;
  /** Longer form for a tooltip or detail row. Never the only carrier of a fact. */
  detail: string;
}

export interface CompletionInput {
  status: string;
  loopKind?: string | null;
  lastCompletedAt?: string | Date | null;
  snoozedUntil?: string | Date | null;
}

const RECURRING = new Set(["DAILY", "WEEKLY"]);

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ET calendar day, matching the day-boundary rule checkTask uses for streaks. */
function etDay(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** "6am", "in 3h", "Mon" — short enough for a row, precise enough to act on. */
function whenBack(target: Date, now: Date): string {
  const mins = Math.round((target.getTime() - now.getTime()) / 60000);
  if (mins <= 0) return "any moment";
  if (mins < 90) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) {
    const hh = target.toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: true,
    });
    return `at ${hh.replace(" ", "").toLowerCase()}`;
  }
  const days = Math.round(hours / 24);
  return days === 1 ? "tomorrow" : `in ${days}d`;
}

/**
 * Decide what to show. Pure, so the canary asserts the real decision.
 *
 * `now` is injected rather than read: this session already misread a 13-hour-old
 * write as six minutes old by inferring the present from data, and a function
 * that reads the clock itself cannot be tested across day boundaries.
 */
export function describeCompletion(task: CompletionInput, now: Date): CompletionDisplay {
  const completed = toDate(task.lastCompletedAt);
  const snoozed = toDate(task.snoozedUntil);
  const isRecurring = RECURRING.has(task.loopKind ?? "");
  const doneToday = completed !== null && etDay(completed) === etDay(now);

  // One-off: status IS the whole truth, and saying so costs nothing.
  if (!isRecurring) {
    if (task.status === "DONE") {
      return { label: "done", frame: "status", detail: "Completed. This task does not recur." };
    }
    return {
      label: task.status.toLowerCase(),
      frame: "status",
      detail: `Current status: ${task.status}.`,
    };
  }

  // Recurring AND completed today — the case the board was getting wrong.
  if (doneToday) {
    const back = snoozed ? whenBack(snoozed, now) : "tomorrow";
    return {
      label: `done today · back ${back}`,
      frame: "both",
      detail:
        `Completed today. It recurs, so its status is ${task.status} until it resurfaces ` +
        `${back}. Showing only "${task.status}" would answer a question you did not ask.`,
    };
  }

  // Recurring, not yet done today, currently parked with a wake time.
  if (snoozed) {
    return {
      label: `snoozed · back ${whenBack(snoozed, now)}`,
      frame: "status",
      detail: `Not completed today. Parked until ${snoozed.toISOString()}.`,
    };
  }

  return {
    label: task.status.toLowerCase(),
    frame: "status",
    detail: `Not completed today. Current status: ${task.status}.`,
  };
}

/**
 * Does this label declare a frame at all?
 *
 * The canary's negative case. A surface that renders completion state with no
 * frame is TODAY'S condition — the board simply printed `WAITING` — so the test
 * has to fail on absence, not only on a wrong value.
 */
export function hasDeclaredFrame(d: Partial<CompletionDisplay> | null | undefined): boolean {
  return d != null && (d.frame === "status" || d.frame === "event" || d.frame === "both");
}
