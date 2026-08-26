/**
 * derive-briefing.ts — the home card's selection logic, as a pure function.
 *
 * EXTRACTED 2026-08-26 from executive-action-matrix.tsx so it can be tested
 * without mounting five tRPC hooks — the same pattern as scripts/_lib/db-gate.ts
 * (a decision you cannot import without side effects is a decision you cannot
 * canary). The component assembles inputs; this file owns the ranking.
 *
 * TWO DEFECTS THE EXTRACTION FIXES, both found by running the OLD chain against
 * live data during the #1897 review:
 *
 * 1 · A HABIT COULD OWN THE PAGE. commandCenterState's "active" is merely the
 *     top DOING task, so the one DOING row — "Drink water — 6+ bottles", a
 *     DAILY loop hand-scored roiScore 70, tied-highest in the entire open set —
 *     rendered as the dominant element with the copy "Maintain focus and close
 *     the loop. Do not context switch until completion." The criticalFew focus
 *     lane already excludes DAILY/WEEKLY loops (next-move.ts) — someone knew
 *     habits must not lead — but the higher-priority ACTIVE/RESUME arms had no
 *     such guard. Now they do: a DAILY/WEEKLY loop in DOING falls through to
 *     the arms below. The habit is not lost — habit surfaces own it; this card
 *     routes ATTENTION, and a running hydration habit has no claim on it.
 *
 * 2 · "URGENT DECISION" WAS IN THE DESIGN AND NOT IN THE CODE. The redesign's
 *     candidate list reads "active task, resume task, urgent decision, or best
 *     next move" — and the old chain never consulted decisions at all, so
 *     approvals could never win the card. The decide arm now sits exactly where
 *     the design put it: after resume, before the warnings and targets.
 *
 * UNKNOWN IS NOT ZERO, decision edition: `pendingDecisions: null` means the
 * approval queries failed on first load. A null never fires the decide arm
 * (cannot claim decisions await) and never lets the idle arm claim "nothing is
 * waiting" unqualified — the idle copy says the approvals read failed. The
 * core-reads failure (tasks/state/targets) still short-circuits to BOARD
 * UNREADABLE exactly as before.
 */

/** Loop kinds that must never claim the attention card's imperative arms. */
const HABIT_LOOPS = new Set(["DAILY", "WEEKLY"]);

export interface BriefingTask {
  title: string;
  loopKind?: string | null;
}

export interface BriefingInputs {
  loading: boolean;
  /** First-load failure of any CORE read (tasks / command state / targets). */
  unreadable: boolean;
  /** commandCenterState's active engagement, if the task list still holds it. */
  doingTask: BriefingTask | null;
  /** Newest non-active DOING task older than the resume floor. */
  resumeTask: BriefingTask | null;
  /** Approvals awaiting a verdict — null when the reads failed (unknown ≠ 0). */
  pendingDecisions: number | null;
  findingsCount: number;
  inboxCount: number;
  criticalFew: Array<{ title: string; roiScore: number }>;
}

export interface Briefing {
  status: "loading" | "error" | "executing" | "resume" | "decide" | "warning" | "nominal" | "idle";
  title: string;
  message: string;
  actionType: "loading" | "error" | "execute" | "resume" | "decide" | "hygiene" | "triage" | "suggestions";
  color: string;
}

const isHabit = (t: BriefingTask | null): boolean =>
  !!t && HABIT_LOOPS.has((t.loopKind ?? "").toUpperCase());

export function deriveBriefing(i: BriefingInputs): Briefing {
  if (i.loading) {
    return {
      status: "loading",
      title: "ANALYZING...",
      message: "Calculating asymmetric leverage...",
      actionType: "loading",
      color: "text-[var(--text-tertiary)]",
    };
  }

  // Unknown-is-not-zero (2026-08-19, unchanged): a failed core read is an
  // instrument fault, never a clear board.
  if (i.unreadable) {
    return {
      status: "error",
      title: "BOARD UNREADABLE",
      message:
        "One or more reads failed — this is an instrument fault, not a clear board. The numbers below may be incomplete.",
      actionType: "error",
      color: "text-rose-400",
    };
  }

  // A DAILY/WEEKLY loop in DOING is deliberately NOT an engagement — see the
  // header. Falls through so decisions and real targets keep the card.
  if (i.doingTask && !isHabit(i.doingTask)) {
    return {
      status: "executing",
      title: "ACTIVE ENGAGEMENT",
      message: `Nour, you are currently executing [${i.doingTask.title}]. Maintain focus and close the loop. Do not context switch until completion.`,
      actionType: "execute",
      color: "text-[var(--gold)]",
    };
  }

  // BDN-001 · resume outranks new targets — with the same habit guard: an
  // interrupted hydration loop is not an open loop worth the page.
  if (i.resumeTask && !isHabit(i.resumeTask)) {
    return {
      status: "resume",
      title: "RESUME OPEN LOOP",
      message: `Nour, [${i.resumeTask.title}] is still marked DOING from earlier. Close that loop — finish it or consciously park it — before opening a new one.`,
      actionType: "resume",
      color: "text-[var(--gold)]",
    };
  }

  // #1897 review · the decide arm the design promised. Count is a true total
  // (both approval sources are uncapped findMany — verified, not assumed).
  if (i.pendingDecisions !== null && i.pendingDecisions > 0) {
    const n = i.pendingDecisions;
    return {
      status: "decide",
      title: "AWAITING YOUR DECISION",
      message: `${n} approval${n === 1 ? " is" : "s are"} parked waiting on you. Nothing downstream moves until you decide — that outranks any new target.`,
      actionType: "decide",
      color: "text-rose-300",
    };
  }

  if (i.findingsCount >= 3) {
    return {
      status: "warning",
      title: "HYGIENE QUEUE BUILDING",
      message: `${i.findingsCount} hygiene findings are waiting. They compound quietly — clear them in your next gap.`,
      actionType: "hygiene",
      color: "text-amber-400",
    };
  }

  if (i.inboxCount >= 7) {
    return {
      status: "warning",
      title: "INBOX OVERFLOW",
      message: `Nour, you are bleeding leverage. Your inbox has ${i.inboxCount} unclassified raw items. Unprocessed material creates cognitive drag. Triage now to reveal hidden bottlenecks.`,
      actionType: "triage",
      color: "text-amber-400",
    };
  }

  if (i.criticalFew.length > 0) {
    const target = i.criticalFew[0];
    return {
      status: "nominal",
      title: "SYSTEMS NOMINAL",
      message: `Hygiene is clear. The Focus Lane is open. The highest leverage asymmetric move is to execute [${target.title}] (Expected ROI: ~${target.roiScore} est.). *(Projected calculation, unverified hypothesis)*.`,
      actionType: "execute",
      color: "text-cyan-400",
    };
  }

  // Honest idle (2026-07-25, unchanged) — plus the decisions qualifier: when
  // the approvals read failed, "nothing is waiting" is not a claim we own.
  const decisionsUnknown = i.pendingDecisions === null;
  return {
    status: "idle",
    title: "ALL QUEUES CLEAR",
    message: decisionsUnknown
      ? "No tasks or targets are waiting — but the approvals read FAILED, so the decision queue is unknown, not empty. Check /system/actions directly."
      : "Nothing is waiting and no immediate targets came back. Pick a direction, or ask Nick for options.",
    actionType: "suggestions",
    color: decisionsUnknown ? "text-amber-400" : "text-emerald-400",
  };
}
