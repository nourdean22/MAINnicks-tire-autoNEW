/**
 * Approval freshness · 2026-09-07 (program D12).
 *
 * An approval is a permission to execute a specific payload against the
 * state of the world AS IT WAS when the request was raised. Permission goes
 * stale; the obligation underneath it does not. Home showed "23 approvals
 * parked · oldest 330 h": most of those could no longer be executed safely,
 * yet they were still counted as decisions waiting on the operator, and
 * nothing prevented approving a two-week-old "send this email" against
 * today's state.
 *
 * This module decides ONE thing — whether an authorization window has
 * passed — and both queues consult it:
 *   · autonomous_actions (rules that deferred with approval="pending") have
 *     no expiry column, so the window is derived from the action type;
 *   · approval_requests (tool executions parked by the guardian) carry an
 *     `expiresAt` the requester set; it was written but never read.
 *
 * What expiry does NOT do: it never records a human decline, never deletes
 * the row, and never hides it. An expired item is listed as expired, cannot
 * be approved (the caller must re-request against current state), and can
 * still be rejected/dismissed by a human.
 *
 * Windows are per effect class — a draft cleanup and an outbound message do
 * not share a shelf life. These are proposals the operator can tune; the
 * default is deliberately short.
 */

export const DEFAULT_FRESHNESS_DAYS = 7;

/** Days an approval for this action type stays executable. */
export const APPROVAL_FRESHNESS_DAYS: Readonly<Record<string, number>> = {
  // outward communication goes stale fastest — the recipient's situation moved
  send_email: 3,
  send_telegram: 3,
  send_sms: 2,
  // money decisions are computed from a snapshot that is gone in two days
  adjust_pricing: 2,
  // record writes tolerate a week
  create_record: 7,
  update_record: 7,
};

/**
 * Operator override · env `APPROVAL_FRESHNESS_DAYS` as JSON, e.g.
 * {"send_email": 5, "default": 10}. Only positive integers are accepted;
 * anything else is ignored and the defaults stand. Read on every call so a
 * Railway env edit takes effect on the next request, no restart needed.
 */
export const FRESHNESS_ENV_KEY = "APPROVAL_FRESHNESS_DAYS";

export function parseFreshnessOverrides(raw: unknown): Record<string, number> {
  if (typeof raw !== "string" || raw.trim().length === 0) return {};
  try {
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isInteger(v) && v > 0 && k.trim()) out[k.trim()] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export interface FreshnessTable {
  defaultDays: number;
  /** Effective window per action type (defaults merged with overrides). */
  windows: Array<{ actionType: string; days: number; source: "default" | "env" }>;
  source: "default" | "env";
}

/** The effective table — what /system/actions shows so the windows are never a mystery. */
export function freshnessTable(env: Record<string, string | undefined> = process.env): FreshnessTable {
  const overrides = parseFreshnessOverrides(env[FRESHNESS_ENV_KEY]);
  const keys = [...new Set([...Object.keys(APPROVAL_FRESHNESS_DAYS), ...Object.keys(overrides).filter((k) => k !== "default")])].sort();
  const windows = keys.map((actionType) => {
    const o = overrides[actionType];
    return o != null
      ? { actionType, days: o, source: "env" as const }
      : { actionType, days: APPROVAL_FRESHNESS_DAYS[actionType] ?? overrides.default ?? DEFAULT_FRESHNESS_DAYS, source: "default" as const };
  });
  const hasEnv = Object.keys(overrides).length > 0;
  return { defaultDays: overrides.default ?? DEFAULT_FRESHNESS_DAYS, windows, source: hasEnv ? "env" : "default" };
}

export function freshnessDaysFor(actionType: string | null | undefined, env: Record<string, string | undefined> = process.env): number {
  const overrides = parseFreshnessOverrides(env[FRESHNESS_ENV_KEY]);
  if (!actionType) return overrides.default ?? DEFAULT_FRESHNESS_DAYS;
  return overrides[actionType] ?? APPROVAL_FRESHNESS_DAYS[actionType] ?? overrides.default ?? DEFAULT_FRESHNESS_DAYS;
}

/** When a deferred autonomous action's authorization window closes. */
export function actionExpiresAt(actionType: string | null | undefined, createdAt: Date): Date {
  return new Date(createdAt.getTime() + freshnessDaysFor(actionType) * 86_400_000);
}

export function isActionExpired(
  row: { actionType: string | null | undefined; createdAt: Date },
  now: Date = new Date(),
): boolean {
  return actionExpiresAt(row.actionType, row.createdAt).getTime() <= now.getTime();
}

/** approval_requests carry their own `expiresAt`; a missing one never expires (legacy rows). */
export function isApprovalRequestExpired(
  row: { expiresAt: Date | null | undefined },
  now: Date = new Date(),
): boolean {
  return row.expiresAt instanceof Date && row.expiresAt.getTime() <= now.getTime();
}

/** Human line for a refused approve — says what to do, not just "no". */
export function expiredApprovalMessage(kind: "action" | "request", expiresAt: Date): string {
  return `authorization expired ${expiresAt.toISOString()} — this ${kind} was approved against state that no longer holds; re-request it against current state or dismiss it`;
}
