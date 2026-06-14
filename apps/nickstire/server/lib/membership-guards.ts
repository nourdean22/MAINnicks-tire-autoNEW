/**
 * Pure guard/decision layer for Nonstop Nick memberships (launch-readiness
 * wave, 2026-06-11). Extracted from the inline logic in routers/memberships.ts
 * and the Stripe webhook (_core/index.ts) so the money-adjacent rules are
 * unit-tested and can't drift between the two call sites — same pattern as
 * lib/tire-order-guards.ts for the tire-order money path.
 */
import { MEMBERSHIP_PLANS, type MembershipPlan } from "../services/payments";

export const MEMBERSHIP_STATUSES = ["active", "past_due", "canceled", "incomplete"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/**
 * Normalize any phone-ish input to the canonical 10-digit US key used
 * everywhere memberships are written (signup metadata + webhook upsert),
 * or null when there aren't 10 digits to work with. The phone is the
 * counter's lookup key — a junk/short value stored here would orphan the
 * membership, so callers must treat null as "don't write".
 */
export function normalizeMembershipPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = String(input).replace(/\D/g, "").slice(-10);
  return digits.length === 10 ? digits : null;
}

/**
 * Map a Stripe subscription lifecycle event to our membership status enum.
 *   - deleted event wins regardless of the snapshot status (Stripe sends the
 *     pre-deletion object on customer.subscription.deleted)
 *   - active/trialing → active (member in good standing)
 *   - past_due/unpaid → past_due (grace — counter sees "Past due", not active)
 *   - canceled → canceled
 *   - anything else (incomplete / incomplete_expired / paused) → incomplete
 */
export function mapSubscriptionEventToStatus(eventType: string, stripeStatus: string): MembershipStatus {
  if (eventType === "customer.subscription.deleted") return "canceled";
  if (stripeStatus === "active" || stripeStatus === "trialing") return "active";
  if (stripeStatus === "past_due" || stripeStatus === "unpaid") return "past_due";
  if (stripeStatus === "canceled") return "canceled";
  return "incomplete";
}

/** Is this metadata plan value a Nonstop Nick tier we sell? (webhook filter) */
export function isKnownMembershipPlan(plan: string): plan is MembershipPlan {
  return plan in MEMBERSHIP_PLANS;
}

/**
 * Order a counter-lookup result so active members surface first (the
 * counter's actual question is "are they active?"), newest first within
 * each group. Pure + stable so the UI order is deterministic.
 */
export function sortMembersActiveFirst<T extends { status: string; createdAt: Date | string | null }>(rows: T[]): T[] {
  const ts = (r: T) => (r.createdAt ? new Date(r.createdAt).getTime() : 0);
  return [...rows].sort((a, b) => {
    const aActive = a.status === "active" ? 0 : 1;
    const bActive = b.status === "active" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return ts(b) - ts(a);
  });
}
