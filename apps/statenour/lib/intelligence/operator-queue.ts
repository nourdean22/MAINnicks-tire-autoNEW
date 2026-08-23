/**
 * What is waiting on the operator, and how bad is it — computed, not narrated.
 *
 * TWO DEFECTS, ONE ARTEFACT. During the 16-day `ingest-reviews` outage
 * (2026-08-04 to 2026-08-19, 64 failures, 4 of 4 runs failing every day) the
 * system sent 20 push notifications. Every one was the routine daily brief.
 * Every one was stamped "Drift: CRITICAL". Not one mentioned the failure.
 *
 * That single artefact contains both problems this module fixes:
 *
 *   1. COVERAGE. The brief reports on the outside world — competitor prices,
 *      search signals, AI news — and says nothing about its own most
 *      time-critical internal state: what is queued awaiting the operator's
 *      decision, and what has passed its TTL. Measured against prod 2026-08-23:
 *      44 items were waiting (20 autonomous_actions, oldest 7 days, including
 *      one customer-facing send_sms_outreach; 24 social_publish_queue drafts,
 *      oldest 25 days) and 2 of 2 approval_requests were past expires_at —
 *      both approved TEN DAYS after expiry, then both failed. The brief
 *      mentioned none of it.
 *
 *   2. LABEL SATURATION. The threat level was LLM-authored prose. The
 *      composer's GROUNDING RULE forbids inventing a number, and "CRITICAL"
 *      is not a number, so it passed straight through. 24 of 30 briefs (80%)
 *      carry the word. A marker that fires four days in five is not a marker.
 *
 * WHY THAT ORDERING MATTERS. Escalating a push on "CRITICAL" is worthless while
 * every brief carries one — you would page the operator daily, they would mute
 * it, and the one real page would be lost with the rest. The marker has to mean
 * something BEFORE anything triggers on it. This module is what makes it mean
 * something: a level derived from counted state, with the counts shown beside it
 * so the operator can audit the verdict instead of trusting it.
 *
 * WHAT IS MEASURED AND WHAT IS JUDGEMENT. The inputs are counted from the
 * database and are facts. The thresholds below are a judgement call and are
 * labelled as one — they are deliberately visible and in one place so they can
 * be tuned against observed firing rates rather than argued about. The
 * mechanism is not a judgement call: a level nobody can recompute is the prose
 * marker again, wearing a function's name.
 */

/** Counted state. Every field comes from a COUNT, never from prose. */
export interface OperatorQueue {
  /** autonomous_actions awaiting an approval decision. */
  pendingActions: number;
  /** Age in days of the oldest pending action. 0 when none. */
  oldestActionDays: number;
  /** Of the pending actions, how many have a customer-facing effect. */
  customerFacingPending: number;
  /** Age in days of the oldest customer-facing pending action. 0 when none. */
  oldestCustomerFacingDays: number;
  /** social_publish_queue drafts awaiting approve/decline. */
  pendingDrafts: number;
  /** Age in days of the oldest pending draft. 0 when none. */
  oldestDraftDays: number;
  /** approval_requests past expires_at that a human could still act on. */
  actionableExpired: number;
}

export type ThreatLevel = "CRITICAL" | "ELEVATED" | "NORMAL";

export interface ThreatVerdict {
  level: ThreatLevel;
  /** The specific counted condition that produced the level. Never a mood. */
  reason: string;
}

/**
 * Action types that reach a real person if executed. These are the ones whose
 * delay is a business cost rather than an internal backlog, so they carry a
 * lower threshold than everything else.
 *
 * Kept as an explicit list rather than a regex: `send_telegram` goes to the
 * operator's own phone and is NOT customer-facing, which a pattern match on
 * "send_" would get wrong in the direction that matters.
 */
export const CUSTOMER_FACING_ACTIONS = [
  "send_sms_outreach",
  "send_email",
  "send_sms",
  "post_social",
  "reply_review",
] as const;

/** THRESHOLDS — judgement, not measurement. Tune against observed firing rate. */
export const THRESHOLDS = {
  /** A customer waiting this long on an unapproved send is a business cost. */
  customerFacingDays: 3,
  /** An internal queue this stale has stopped being a queue. */
  staleQueueDays: 21,
  /** Depth at which the queue is the problem regardless of any single age. */
  deepQueue: 40,
  /** Anything older than this is worth naming, short of critical. */
  elevatedDays: 7,
} as const;

/**
 * Derive the threat level from counted state.
 *
 * Pure and exported so a test can assert the exact conditions, and so the
 * operator can recompute the verdict from the numbers printed beside it. An
 * earlier version of this marker was a sentence a model wrote; the defect was
 * not that the sentence was wrong but that nothing could check it.
 */
export function deriveThreatLevel(q: OperatorQueue): ThreatVerdict {
  if (q.actionableExpired > 0) {
    return {
      level: "CRITICAL",
      reason: `${q.actionableExpired} approval request(s) past their TTL and still actionable — the window to decide has already closed`,
    };
  }
  if (q.customerFacingPending > 0 && q.oldestCustomerFacingDays >= THRESHOLDS.customerFacingDays) {
    return {
      level: "CRITICAL",
      reason: `${q.customerFacingPending} customer-facing action(s) unapproved for ${q.oldestCustomerFacingDays}d — a real person is waiting`,
    };
  }
  if (q.oldestDraftDays >= THRESHOLDS.staleQueueDays || q.oldestActionDays >= THRESHOLDS.staleQueueDays) {
    return {
      level: "CRITICAL",
      reason: `oldest queued item is ${Math.max(q.oldestDraftDays, q.oldestActionDays)}d old — the queue has stopped moving`,
    };
  }
  if (q.pendingActions + q.pendingDrafts >= THRESHOLDS.deepQueue) {
    return {
      level: "ELEVATED",
      reason: `${q.pendingActions + q.pendingDrafts} items awaiting a decision`,
    };
  }
  if (q.oldestActionDays >= THRESHOLDS.elevatedDays || q.oldestDraftDays >= THRESHOLDS.elevatedDays) {
    return {
      level: "ELEVATED",
      reason: `oldest queued item is ${Math.max(q.oldestActionDays, q.oldestDraftDays)}d old`,
    };
  }
  if (q.pendingActions + q.pendingDrafts === 0) {
    // "0 items" rather than "nothing": every reason carries a counted quantity,
    // including this one. A reason with no number is the prose marker again in a
    // quieter voice, and it is the one case where it would be easy to excuse.
    return { level: "NORMAL", reason: "0 items awaiting a decision" };
  }
  return {
    level: "NORMAL",
    reason: `${q.pendingActions + q.pendingDrafts} items queued, none stale`,
  };
}

/**
 * The deterministic block injected into the composer prompt.
 *
 * This is NOT passed to the model to summarise — it is prepended to the brief
 * verbatim by the caller. The model cannot round it, soften it, drop it for
 * space, or restate 20 as "several". The brief's GROUNDING RULE already forbids
 * inventing numbers; this closes the other half, where the model omits a number
 * that exists because nothing told it the number was there.
 */
export function renderOperatorQueue(q: OperatorQueue, verdict: ThreatVerdict): string {
  const lines: string[] = [];
  lines.push(`## ⏳ Awaiting You (${q.pendingActions + q.pendingDrafts} items)`);
  lines.push("");
  lines.push(`**Threat level: ${verdict.level}** — ${verdict.reason}.`);
  lines.push("");

  if (q.pendingActions + q.pendingDrafts === 0 && q.actionableExpired === 0) {
    lines.push("Nothing is waiting on a decision (0 actions, 0 drafts, 0 past TTL).");
    return lines.join("\n");
  }

  if (q.pendingActions > 0) {
    lines.push(
      `- **${q.pendingActions} automation action(s)** awaiting approval, oldest ${q.oldestActionDays}d.` +
        (q.customerFacingPending > 0
          ? ` ${q.customerFacingPending} of them are customer-facing (oldest ${q.oldestCustomerFacingDays}d).`
          : " None are customer-facing."),
    );
  }
  if (q.pendingDrafts > 0) {
    lines.push(`- **${q.pendingDrafts} content draft(s)** awaiting approve/decline, oldest ${q.oldestDraftDays}d.`);
  }
  if (q.actionableExpired > 0) {
    lines.push(
      `- **${q.actionableExpired} approval request(s) past TTL** and still actionable. ` +
        `Approving after expiry has already happened here and both executions then failed, so an expired row is not a harmless one.`,
    );
  }
  return lines.join("\n");
}
