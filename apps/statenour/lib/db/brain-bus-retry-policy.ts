/**
 * Brain-bus per-topic retry policy · v10.0.90 · 2026-05-02.
 *
 * Replaces the global maxAttempts=5 + fixed backoff ladder with
 * per-topic config. Some topics need eventual delivery (e.g.,
 * embedding-warm: must complete or memory recall stays cold);
 * others are fire-and-forget (e.g., chat-importance: dropping
 * one row is acceptable).
 *
 * Each policy controls:
 *   · maxAttempts — how many tries before transitioning to 'dead'
 *   · backoffSchedule — array of milliseconds, one per attempt
 *   · deadAction — what to do after max-out:
 *       'mark_dead' (default) · keep in 'dead' for operator review
 *       'silently_drop' · delete the row (low-value events)
 *       'escalate_telegram' · push to Telegram via brain-bus-alert
 *
 * Default policy is the historic v8.4 behavior so behavior is
 * unchanged for any topic that doesn't have an override.
 */

const DEFAULT_BACKOFFS = [
  60_000, // 1m
  300_000, // 5m
  1_800_000, // 30m
  7_200_000, // 2h
  21_600_000, // 6h
];

export interface RetryPolicy {
  maxAttempts: number;
  backoffSchedule: number[];
  deadAction: "mark_dead" | "silently_drop" | "escalate_telegram";
}

const DEFAULT_POLICY: RetryPolicy = {
  maxAttempts: 5,
  backoffSchedule: DEFAULT_BACKOFFS,
  deadAction: "mark_dead",
};

const POLICIES: Record<string, RetryPolicy> = {
  // ── EVENTUAL-DELIVERY (must succeed) ─────────────────────────
  "embedding-warm": {
    maxAttempts: 8,
    backoffSchedule: [60_000, 300_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 14_400_000, 28_800_000],
    deadAction: "escalate_telegram",
  },
  "knowledge-graph-edge": {
    maxAttempts: 6,
    backoffSchedule: [120_000, 600_000, 1_800_000, 7_200_000, 21_600_000, 86_400_000],
    deadAction: "mark_dead",
  },
  "task-event": {
    maxAttempts: 6,
    backoffSchedule: [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 86_400_000],
    deadAction: "escalate_telegram",
  },
  "goal-event": {
    maxAttempts: 6,
    backoffSchedule: [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 86_400_000],
    deadAction: "escalate_telegram",
  },

  // ── BEST-EFFORT (drop is acceptable) ─────────────────────────
  "chat-importance": {
    maxAttempts: 3,
    backoffSchedule: [60_000, 300_000, 1_800_000],
    deadAction: "silently_drop",
  },
  "ui-telemetry": {
    maxAttempts: 2,
    backoffSchedule: [30_000, 120_000],
    deadAction: "silently_drop",
  },
  "narrator-feedback": {
    maxAttempts: 3,
    backoffSchedule: [60_000, 300_000, 1_800_000],
    deadAction: "mark_dead",
  },

  // ── ALERT-CRITICAL (escalate fast) ───────────────────────────
  "system-alert": {
    maxAttempts: 4,
    backoffSchedule: [30_000, 120_000, 600_000, 3_600_000],
    deadAction: "escalate_telegram",
  },
  "schema-drift": {
    maxAttempts: 4,
    backoffSchedule: [60_000, 300_000, 1_800_000, 7_200_000],
    deadAction: "escalate_telegram",
  },
};

/**
 * Get the retry policy for a topic. Falls back to default.
 */
export function getRetryPolicy(topic: string): RetryPolicy {
  return POLICIES[topic] ?? DEFAULT_POLICY;
}

/**
 * Compute the next-available delay for a given topic at a given
 * attempt count.
 */
export function backoffMs(topic: string, attempt: number): number {
  const policy = getRetryPolicy(topic);
  const idx = Math.min(attempt - 1, policy.backoffSchedule.length - 1);
  return policy.backoffSchedule[Math.max(0, idx)] ?? DEFAULT_BACKOFFS[0];
}

/**
 * Check if this topic should escalate to Telegram on max-out.
 */
export function shouldEscalate(topic: string): boolean {
  return getRetryPolicy(topic).deadAction === "escalate_telegram";
}

/**
 * Check if this topic should silently drop on max-out (don't even
 * keep the row).
 */
export function shouldDrop(topic: string): boolean {
  return getRetryPolicy(topic).deadAction === "silently_drop";
}

/**
 * Inspector — for /api/system/brain-bus/policies.
 */
export function listAllPolicies() {
  return Object.entries(POLICIES).map(([topic, p]) => ({
    topic,
    maxAttempts: p.maxAttempts,
    backoffMinutes: p.backoffSchedule.map((ms) => Math.round(ms / 60_000)),
    deadAction: p.deadAction,
  }));
}
