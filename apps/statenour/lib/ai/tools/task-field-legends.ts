/**
 * Legends for the opaque code enums that task-shaped tools ask the model for.
 *
 * WHY THIS MODULE EXISTS. Prod `tool_telemetry` recorded `createTask` failing
 * because the model answered `{"effort":"30 min"}` and
 * `{"context":"Newsletter creation"}` — free text, because "M30" and "DESK" are
 * unguessable and neither field carried a `.describe()`. `context` is the worst
 * offender: it reads as "contextual information about this task" unless
 * something says otherwise, and three separate stored failures put a task
 * description or a whole journal reflection in it.
 *
 * That was fixed on 2026-09-03 — on ONE of SIX call sites. A mechanical sweep
 * (`tests/ai/tool-enum-legends.test.ts`) found the other five:
 * `addTasksToProject`, `createMissionPlan`, `updateTask`, `scheduleFollowUp`
 * and `logSituation`. `createMissionPlan` was still failing two months later at
 * 4 calls / 1 success (25%), its stored failure reading `{"context":"Shop
 * Operat…` — the identical shape.
 *
 * Six copies of a string is why one fix reached one of them. The text lives
 * here now, and the sweep fails if a schema drifts off it.
 *
 * SCOPE: model-facing tool schemas ONLY. The DB-facing validators in
 * lib/validators/tasks.ts stay strict and undescribed on purpose — the model is
 * the unreliable producer, not the API.
 */
import { z } from "zod";

export const EFFORT_LEGEND =
  "Time budget as a CODE, not a duration string. Exactly one of: M5 (5 min) · M15 (15 min) · M30 (30 min) · H1 (1 hour) · H2PLUS (2+ hours).";

export const CONTEXT_LEGEND =
  "WHERE the task gets done, as a CODE - not a topic or description. Exactly one of: DESK · PHONE · SHOP · CAR · HOME · ANYWHERE.";

/** For schemas whose loopKind vocabulary includes WEEKLY. */
export const LOOP_KIND_LEGEND_WEEKLY =
  "ONCE = one-shot · DAILY = repeats every day · WEEKLY = repeats on set weekdays (also send recurringDays) · PROMISE = commitment to someone (also send promiseTo).";

/** For schemas without WEEKLY. Kept separate so neither legend lists a value the schema would reject. */
export const LOOP_KIND_LEGEND =
  "ONCE = one-shot · DAILY = repeats every day · PROMISE = commitment to someone (also send promiseTo).";

export const EFFORT_VALUES = ["M5", "M15", "M30", "H1", "H2PLUS"] as const;
export const CONTEXT_VALUES = ["DESK", "PHONE", "SHOP", "CAR", "HOME", "ANYWHERE"] as const;

/**
 * `defaultValue` is a parameter because the call sites genuinely disagree —
 * `createTask` budgets M30, `scheduleFollowUp` M15 — and quietly unifying them
 * would change behaviour under cover of a documentation fix.
 */
export function effortField(defaultValue: (typeof EFFORT_VALUES)[number] = "M30") {
  return z.enum(EFFORT_VALUES).default(defaultValue).describe(EFFORT_LEGEND);
}

export function contextField() {
  return z.enum(CONTEXT_VALUES).default("ANYWHERE").describe(CONTEXT_LEGEND);
}
