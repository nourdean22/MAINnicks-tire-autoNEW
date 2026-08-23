/**
 * Generated subtasks must be NEXT ACTIONS, not decisions about them.
 *
 * THE ARTEFACT THIS EXISTS FOR (live, 2026-08-23). A staleness detector found an
 * open loop and the system responded by decomposing it into six subtasks. The
 * first was:
 *
 *     "Decide on action for the open loop"
 *
 * which is the original problem restated as a child of itself. The system detected
 * an open loop and created six more.
 *
 * GROUNDING. "Open loop" is David Allen's own term, so the generator is already
 * speaking GTD vocabulary — and GTD's central rule is that a next action is the
 * next PHYSICAL, VISIBLE action. A decision is definitionally not one; the point is
 * made directly in "A decision is not a next action"
 * (https://ccowan.substack.com/p/a-decision-is-not-a-next-action). The wider
 * consensus is that vague entries drive procrastination and that an item written
 * down but not resolved into a physical action REMAINS an open loop —
 * https://hamberg.no/gtd and
 * https://super-productivity.com/blog/gtd-next-actions-guide/.
 *
 * The generator's prompt already asks for "specific physical steps". It asked
 * correctly and got a decision anyway. A prompt is a request; this is the contract.
 *
 * WHY REJECT RATHER THAN REWRITE. Rewriting "Decide on X" into a physical action
 * requires knowing which option was chosen, which is precisely the thing the
 * operator has not decided. Inventing one would fabricate a decision on his
 * behalf. Fewer, better, or nothing.
 */

/**
 * Verbs that describe deliberation, not action. A subtask opening with one of
 * these is a decision wearing a checkbox.
 *
 * Deliberately anchored to the START of the title: "Call the shop to decide on
 * pricing" is a real physical action that happens to contain "decide", and a
 * substring match would reject it. What fails is a title whose PRIMARY verb is
 * cognitive.
 */
const NON_ACTION_OPENERS = [
  "decide",
  "determine",
  "consider",
  "review",
  "think",
  "reflect",
  "evaluate",
  "assess",
  "figure out",
  "look into",
  "explore options",
  "research options",
  "identify the",
  "understand",
  "clarify",
  "plan out",
] as const;

/**
 * Work performed ON the tracker rather than on the world. "Update task tracker
 * with outcome" asks the operator to maintain the system that exists to serve
 * him — and completion already records the outcome, so it is a side effect being
 * charged as a step.
 */
const META_WORK_PATTERNS = [
  // Verb-anchored like the other four. A bare /\btracker\b/ rejected
  // "Install the GPS tracker on the loaner truck" — a real physical action in a
  // tire shop — and two such titles in a three-item batch would trip minKept and
  // suppress the whole decomposition. An over-broad validator gets deleted the
  // first time it blocks something good, which costs more than it saved.
  /\b(update|updating|check|maintain|log|record|sync) (the )?(task |todo )?tracker\b/i,
  /\bupdate (the )?(task|todo|tracking) (list|system|tracker|board)\b/i,
  /\bmark (it |the task )?(as )?(done|complete)/i,
  /\blog (the )?(outcome|result|completion)\b/i,
  /\bclose (the )?(loop|ticket|item) in\b/i,
] as const;

/**
 * Disposition verbs — ways of getting an item OFF the list rather than steps
 * toward finishing it. Closing, delegating, deferring and dropping are the
 * classic GTD dispositions: each one, on its own, fully resolves the parent.
 *
 * THE ARTEFACT. The live decomposition (five children, verified in prod
 * 2026-08-23) offered three of them at once:
 *
 *     Create recurring Monday calendar event      (schedule it)
 *     Delegate the recurring task to shop manager (delegate it)
 *     Close the open loop                         (drop it)
 *
 * Each is a legitimate physical action, so every one survives
 * validateSubtaskTitle — correctly. The defect is not in any single title, it
 * is in the SET: these are alternatives, and subtasks are conjunctive. A
 * checklist means "do all of these". Rendering a disjunction as a conjunction
 * asks the operator to schedule, delegate AND abandon the same item, and
 * guarantees the parent can never legitimately reach 100%.
 *
 * Two is the threshold because one disposition is an ordinary next action
 * ("Delegate the tire order to Mike"), while two or more can only be a menu.
 * Detection is deliberately partial — "Create ... calendar event" is a
 * disposition in meaning but not by its opening verb, and inferring that
 * needs judgment this file should not pretend to have. Two of the three are
 * caught, the threshold is met, and the batch suppresses. A rule that fires
 * correctly on the real case beats a cleverer one that misfires on ordinary
 * work.
 */
const DISPOSITION_OPENERS = [
  "close",
  "delegate",
  "defer",
  "drop",
  "cancel",
  "archive",
  "snooze",
  "postpone",
  "reschedule",
  "abandon",
  "hand off",
  "pass to",
] as const;

/** How many of these titles are dispositions of the parent rather than steps? */
export function countDispositions(titles: readonly string[]): number {
  return titles.filter((t) => {
    const n = normalise(t);
    return DISPOSITION_OPENERS.some((v) => n === v || n.startsWith(v + " "));
  }).length;
}

export interface SubtaskVerdict {
  ok: boolean;
  /** Present when ok === false. Operator-facing, names the rule. */
  reason?: string;
}

/** Normalise for matching: strip leading list markers, collapse space, lowercase. */
function normalise(title: string): string {
  return title
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Is this generated subtask a real next action?
 *
 * Pure and exported so the canary can assert the exact live artefact is rejected,
 * rather than asserting that a validator merely exists.
 */
export function validateSubtaskTitle(title: string): SubtaskVerdict {
  const t = normalise(title);

  if (t.length < 3) {
    return { ok: false, reason: "title is empty or too short to be an action" };
  }

  for (const verb of NON_ACTION_OPENERS) {
    if (t === verb || t.startsWith(verb + " ")) {
      return {
        ok: false,
        reason:
          `"${title}" opens with "${verb}" — that is a decision or a deliberation, ` +
          "not a next physical action. GTD's rule is that a next action is the next " +
          "PHYSICAL, VISIBLE action; a decision restated as a subtask leaves the open " +
          "loop open.",
      };
    }
  }

  for (const re of META_WORK_PATTERNS) {
    if (re.test(t)) {
      return {
        ok: false,
        reason:
          `"${title}" is work performed on the tracker rather than on the world. ` +
          "Recording an outcome is a side effect of completing a task, not a step in it.",
      };
    }
  }

  return { ok: true };
}

/**
 * Filter a generated batch, and decide whether what survives is worth showing.
 *
 * THE GATE. If a generator cannot produce concrete physical actions, it must
 * produce NONE and let the operator decide — six wrong checkboxes are worse than
 * zero, because they render a progress bar that can never legitimately reach 100%
 * and they bury the actual decision under busywork.
 *
 * `minKept` is 2 rather than 1 on purpose: a single surviving subtask is not a
 * decomposition, it is a rename of the parent.
 */
export function filterGeneratedSubtasks<T extends { title: string }>(
  subtasks: readonly T[],
  opts: { minKept?: number } = {},
): {
  kept: T[];
  /** Titles that failed per-title validation — each one is not a next action. */
  rejected: Array<{ title: string; reason: string }>;
  /** Titles that PASSED per-title validation and were still dropped by a
   *  batch-level rule. Kept separate from `rejected` on purpose: these ARE
   *  next actions, and logging them under a "not a next action" event would
   *  state the opposite of the finding. */
  droppedByBatchRule: Array<{ title: string; reason: string }>;
  suppressed: boolean;
  /** Why the batch was suppressed — distinguishes "nothing real survived"
   *  from "these are alternatives", which are different operator messages. */
  suppressedReason: "none" | "too_few_actions" | "alternatives_not_steps";
} {
  const minKept = opts.minKept ?? 2;
  const kept: T[] = [];
  const rejected: Array<{ title: string; reason: string }> = [];

  for (const s of subtasks) {
    const v = validateSubtaskTitle(s.title);
    if (v.ok) kept.push(s);
    else rejected.push({ title: s.title, reason: v.reason ?? "not a next action" });
  }

  // Fewer, better, or nothing.
  if (kept.length < minKept) {
    return {
      kept: [],
      rejected,
      droppedByBatchRule: [],
      suppressed: true,
      suppressedReason: "too_few_actions",
    };
  }

  // A menu of exits is not a decomposition. Checked against what SURVIVED,
  // not the raw batch: the dispositions are exactly the titles that pass
  // validateSubtaskTitle, so checking the input would double-count rejects
  // and could fire on a batch whose alternatives were already removed.
  if (countDispositions(kept.map((k) => k.title)) >= 2) {
    return {
      kept: [],
      rejected,
      droppedByBatchRule: kept.map((k) => ({
        title: k.title,
        reason:
          "this IS a next action, but its siblings are alternatives to it — subtasks " +
          "are conjunctive (a checklist means do ALL of them), so a set of mutually " +
          "exclusive dispositions cannot be rendered as one. The choice is the operator's.",
      })),
      suppressed: true,
      suppressedReason: "alternatives_not_steps",
    };
  }

  return { kept, rejected, droppedByBatchRule: [], suppressed: false, suppressedReason: "none" };
}
