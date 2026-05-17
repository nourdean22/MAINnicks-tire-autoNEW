/**
 * Goal Pace — projection chip math for the PLAN tab.
 *
 * Apr 26 · G1. Reads (currentValue, targetValue, deadline, createdAt)
 * and returns a tight verdict for the goal-card chip:
 *
 *   · "ahead Nd"        — pace > required, finish before deadline
 *   · "on track"        — within ±10% of required pace
 *   · "behind Nd"       — pace < required, will miss deadline by N days
 *   · "needs N/day"     — no progress yet but realistic per-day rate
 *   · "off pace · M/day"— behind + per-day rate to recover
 *   · "unscored"        — no deadline OR no targetValue (can't compute)
 *
 * Pure function — no DB, no React. Caller renders the verdict.
 */

export type PaceVerdict =
  | { kind: "unscored" }
  | { kind: "needs"; perDay: number; daysLeft: number }
  | { kind: "ahead"; daysAhead: number; perDay: number }
  | { kind: "on-track"; perDay: number; daysLeft: number }
  | { kind: "behind"; daysBehind: number; perDay: number; needPerDay: number }
  | { kind: "missed"; overdueDays: number };

interface PaceInput {
  currentValue: number;
  targetValue: number;
  deadline: string | null;
  createdAt: string | null;
}

const DAY_MS = 86_400_000;

export function computePace({
  currentValue,
  targetValue,
  deadline,
  createdAt,
}: PaceInput): PaceVerdict {
  if (!deadline || !targetValue || targetValue <= 0) {
    return { kind: "unscored" };
  }

  const now = Date.now();
  const deadlineMs = new Date(deadline).getTime();
  const startMs = createdAt ? new Date(createdAt).getTime() : now - DAY_MS;
  const totalDuration = Math.max(DAY_MS, deadlineMs - startMs);
  const elapsed = Math.max(DAY_MS, now - startMs);
  const daysLeft = Math.max(0, Math.round((deadlineMs - now) / DAY_MS));
  const overdueDays = Math.max(0, Math.round((now - deadlineMs) / DAY_MS));

  // Past deadline
  if (now > deadlineMs) {
    if (currentValue >= targetValue) {
      return { kind: "ahead", daysAhead: 0, perDay: 0 };
    }
    return { kind: "missed", overdueDays };
  }

  // Required vs actual rates
  const requiredRemaining = targetValue - currentValue;
  const needPerDay = daysLeft > 0 ? requiredRemaining / daysLeft : requiredRemaining;
  const actualRate = currentValue / (elapsed / DAY_MS); // units per day so far
  const expectedSoFar = (targetValue * elapsed) / totalDuration;

  // Zero progress so far → just say what's needed
  if (currentValue === 0) {
    return { kind: "needs", perDay: round1(needPerDay), daysLeft };
  }

  const ratio = expectedSoFar > 0 ? currentValue / expectedSoFar : 1;

  // ±10% bucket = on track
  if (ratio >= 0.9 && ratio <= 1.1) {
    return { kind: "on-track", perDay: round1(actualRate), daysLeft };
  }

  // Ahead — figure out how many extra days at current rate we'd finish
  if (ratio > 1.1) {
    const projectedFinishDays = actualRate > 0 ? (targetValue - currentValue) / actualRate : daysLeft;
    const daysAhead = Math.max(0, daysLeft - Math.round(projectedFinishDays));
    return { kind: "ahead", daysAhead, perDay: round1(actualRate) };
  }

  // Behind — projected to miss; how many days?
  const projectedFinishMs = actualRate > 0
    ? now + ((targetValue - currentValue) / actualRate) * DAY_MS
    : Infinity;
  const daysBehind = projectedFinishMs === Infinity
    ? 999
    : Math.max(0, Math.round((projectedFinishMs - deadlineMs) / DAY_MS));
  return {
    kind: "behind",
    daysBehind,
    perDay: round1(actualRate),
    needPerDay: round1(needPerDay),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Render the verdict as a tiny inline string. Caller decides color
 * via verdict.kind (ahead = emerald, on-track = sky, behind = amber,
 * missed = rose, needs = zinc, unscored = no chip).
 */
export function paceLabel(v: PaceVerdict, unit: string = ""): string {
  const u = unit ? unit : "";
  switch (v.kind) {
    case "unscored":
      return "";
    case "needs":
      return `needs ${formatRate(v.perDay)}${u ? ` ${u}` : ""}/day · ${v.daysLeft}d left`;
    case "ahead":
      return v.daysAhead > 0
        ? `ahead ${v.daysAhead}d · ${formatRate(v.perDay)}/day`
        : `at target`;
    case "on-track":
      return `on track · ${formatRate(v.perDay)}/day · ${v.daysLeft}d left`;
    case "behind":
      return v.needPerDay > 0
        ? `behind · need ${formatRate(v.needPerDay)}/day to catch up`
        : `behind ${v.daysBehind}d · ${formatRate(v.perDay)}/day`;
    case "missed":
      return `${v.overdueDays}d past deadline`;
  }
}

/**
 * Compact render (~14 chars max) for tight chip layouts.
 */
export function paceLabelShort(v: PaceVerdict): string {
  switch (v.kind) {
    case "unscored":
      return "";
    case "needs":
      return `${v.daysLeft}d · ${formatRate(v.perDay)}/d`;
    case "ahead":
      return v.daysAhead > 0 ? `+${v.daysAhead}d ahead` : `at target`;
    case "on-track":
      return `on track · ${v.daysLeft}d`;
    case "behind":
      return `behind ${v.daysBehind}d`;
    case "missed":
      return `${v.overdueDays}d late`;
  }
}

export function formatRate(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  if (n >= 100) return String(Math.round(n));
  if (n >= 10) return n.toFixed(1).replace(/\.0$/, "");
  if (n >= 1) return n.toFixed(1);
  if (n >= 0.1) return n.toFixed(2);
  return n.toFixed(3);
}
