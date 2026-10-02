/**
 * lib/system/owner-panel.ts · 2026-09-23 · Q-24 (estate master architecture §9)
 *
 * ONE panel for the owner: (a) exceptions that need him, (b) decisions
 * waiting on him, (c) cost per outcome. It composes reads that already
 * exist — it re-hosts none of them:
 *
 *   · cron runs        -> cron_job_logs (HARD_FAILURE_STATUSES, skipReason #2612)
 *   · deploy pages     -> action_attempts where tool = railway.deploy_alert (#2597)
 *   · approvals        -> listPendingActions() + approval_requests, the same two
 *                         reads Home's judgment queue counts (operator-brief.ts)
 *   · commitments      -> commitments past their deadline, still active/accepted
 *   · lanes            -> listLaneStatus() (lib/ai/budget.ts), a capped lane
 *                         past its cap is STOPPED until midnight ET (startOfDay)
 *   · cost             -> ai_generations cost_cents, tasks marked DONE
 *   · capabilities     -> integrations type=capability, the guardian's durable
 *                         failure receipts (lib/system/capability-health.ts, 2026-10-02)
 *   · degraded runs    -> cron_job_logs status=partial carrying the declared-degradation
 *                         prefix (the brief's compose timeout, 2026-10-02); a plain partial
 *                         (fan-out children failed) is diagnose-cron-failure's, not paged
 *
 * Rules (each one is the empty-vs-error skill):
 *   · a failed read is named in `unreadable` and the verdict is UNKNOWN,
 *     never "clear" — a source that could not be read hid nothing we know of,
 *     which is not the same as hiding nothing;
 *   · cost tiles carry MEASURED / ESTIMATE / UNMEASURED; an unmeasured value
 *     is null with its reason, never a zero;
 *   · healthy fades: a job whose latest run worked, a delivered page older
 *     than the window, a live approval inside its freshness window — none of
 *     them is an exception.
 *
 * Canary: tests/lib/system/owner-panel.test.ts.
 */

import { declaredDegradationReason, isDeclaredDegradation, isHardFailure } from "@/lib/services/cron-status";
import { endOfDayET } from "@/lib/utils/datetime";

export const EXCEPTION_WINDOW_MS = 24 * 60 * 60_000;
export const COST_WINDOW_DAYS = 7;
/** A job must have skipped at least this many runs in the window, and done nothing else, to page the owner. */
export const SKIP_STREAK_MIN = 2;
export const DECISIONS_VISIBLE_CAP = 5;
export const DEPLOY_ALERT_TOOL = "railway.deploy_alert";
/** In-flight consequential actions older than this are no longer ordinary latency. */
export const ACTION_EXECUTION_STALE_MS = 30 * 60_000;
/** A capability row nothing touched for this long is history, not a live exception. */
export const CAPABILITY_WINDOW_MS = 7 * 24 * 60 * 60_000;

const TERMINAL = new Set(["success", "partial", "failed", "interrupted"]);
/** ActionAttempt states that record the provider accepted the page (lib/services/action-attempts.ts). */
const DELIVERED_STATES = new Set(["SUCCEEDED_UNVERIFIED", "VERIFIED"]);

export type Provenance = "MEASURED" | "ESTIMATE" | "UNMEASURED";

export interface OwnerItem {
  key: string;
  kind:
    | "cron_failed"
    | "cron_skipping"
    | "deploy_page"
    | "approval_expired"
    | "commitment_overdue"
    | "lane_stopped"
    | "outbox_dead"
    | "action_failed"
    | "action_unknown"
    | "action_stalled"
    | "approval"
    | "cron_degraded"
    | "capability_degraded";
  tone: "rose" | "amber" | "neutral";
  title: string;
  detail: string | null;
  /** When the condition began (ISO). Null when the source carries no time. */
  since: string | null;
  ageMin: number | null;
  /** Where the evidence can be opened. Null when no surface renders it — `evidence` still names the row. */
  href: string | null;
  /** The table + row the claim rests on, so it can be checked by hand. */
  evidence: string;
}

export interface CostTile {
  key: string;
  label: string;
  /** Rendered value; null when UNMEASURED. */
  value: string | null;
  provenance: Provenance;
  note: string;
}

export interface OwnerPanel {
  state: "clear" | "attention" | "unknown";
  headline: string;
  exceptions: OwnerItem[];
  decisions: OwnerItem[];
  decisionsHidden: number;
  cost: CostTile[];
  /** Sources whose read failed this time — their absence from the lists is NOT a clear. */
  unreadable: string[];
  generatedAt: string;
}

export interface CronRow {
  id: string;
  jobName: string;
  status: string;
  error: string | null;
  skipReason: string | null;
  createdAt: Date;
}
export interface PageRow {
  id: string;
  operationKey: string;
  state: string;
  reason: string | null;
  startedAt: Date;
}
export interface PendingActionLite {
  id: string;
  ruleName: string;
  actionType: string;
  createdAt: Date;
  expired: boolean;
}
export interface ApprovalRequestLite {
  id: string;
  actionType: string;
  reason: string;
  createdAt: Date;
  expiresAt: Date;
}
export interface CommitmentLite {
  id: number;
  description: string;
  deadline: string | null;
  toWhom: string;
}
export interface LaneLite {
  feature: string;
  spentCents: number;
  capCents: number | null;
  over: boolean;
}
export interface SpendLite {
  costCents: number;
  calls: number;
  /** Calls whose cost_cents is NULL — the spend is a floor while this is > 0. */
  unpricedCalls: number;
}
export interface ValueAttributionLite {
  measurementState: "MEASURED" | "ESTIMATE" | "UNMEASURED";
  matchedRefs: number;
  matchedMeasuredCostCents: number;
  matchedMeasuredRecoveredRevenueCents: number;
  measuredRecoveredOutcomes: number;
  costPerRecoveredOutcomeCents: number | null;
  recoveredRevenuePerSendCostDollar: number | null;
  estimatedSendCostCents: number;
  estimatedRecoveredRevenueCents: number;
  /** All measured send cost in the window. In the ESTIMATE state none of it joined revenue. */
  measuredSendCostCents?: number;
  /** All measured holdout-adjusted recovered revenue in the window, joined or not. */
  measuredRecoveredRevenueCents?: number;
  reasons: string[];
}
export interface OutboxHealthLite {
  pending: number;
  processing: number;
  done24h: number;
  dead: number;
  oldestDeadAt: string | null;
  lastDeadError: string | null;
}
export interface ActionAttemptLite {
  id: string;
  operationKey: string;
  tool: string;
  effectClass: string;
  state: string;
  reason: string | null;
  startedAt: Date;
  settledAt: Date | null;
  updatedAt: Date;
}
/** One `integrations` row of type `capability` (lib/system/capability-health.ts). */
export interface CapabilityLite {
  name: string;
  /** healthy | degraded | failed | disabled — only degraded/failed are read. */
  status: string;
  consecutiveFailures: number;
  errorCount: number;
  /** JSON: lastError, lastCategory, firstFailureAt, lastFailureAt, lastRecoveryAt. Shape-checked at read. */
  metadata: unknown;
  updatedAt: Date;
}

/** null = that read FAILED. [] / 0 = it succeeded and found nothing. */
export interface OwnerPanelInput {
  now: Date;
  /** Today in ET, YYYY-MM-DD — commitment deadlines are ET calendar dates. */
  todayYmd: string;
  cronRows: CronRow[] | null;
  deployPages: PageRow[] | null;
  pendingActions: PendingActionLite[] | null;
  /** LIVE requests only (expiresAt in the future). Expired rows stay `pending_approval` forever,
   *  so reading both in one capped list lets an expired backlog push every live one out. */
  approvalRequests: ApprovalRequestLite[] | null;
  /** Expired-but-still-pending requests, counted — never listed, so a backlog cannot flood the panel. */
  expiredRequests: { count: number; oldest: Date | null } | null;
  commitments: CommitmentLite[] | null;
  lanes: LaneLite[] | null;
  /** Existing post-turn durability queue health; dead rows are exceptions. */
  outboxHealth: OutboxHealthLite | null;
  /** Consequential attempts that are unresolved, failed, or still executing. */
  actionAttempts: ActionAttemptLite[] | null;
  spend: SpendLite | null;
  tasksDone: number | null;
  /** Explicit source-backed cost/value attribution. null means the read itself failed. */
  valueAttribution: ValueAttributionLite | null;
  /** Guarded capabilities currently degraded or failed. null = that read FAILED. */
  capabilities: CapabilityLite[] | null;
}

const clip = (s: string | null | undefined, n = 140): string | null => {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** An ISO string out of a JSON column, or null when absent or unparseable. */
const parseIso = (v: unknown): Date | null => {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
};

function item(now: Date, base: Omit<OwnerItem, "ageMin" | "since"> & { since: Date | null }): OwnerItem {
  return {
    ...base,
    since: base.since ? base.since.toISOString() : null,
    ageMin: base.since ? Math.max(0, Math.round((now.getTime() - base.since.getTime()) / 60_000)) : null,
  };
}

/** Per job: the latest terminal run failed -> failed; every terminal run skipped -> skipping. */
export function cronExceptions(rows: CronRow[], now: Date): OwnerItem[] {
  const byJob = new Map<string, CronRow[]>();
  for (const r of rows) {
    if (!TERMINAL.has(r.status)) continue; // started / duplicate witness invocation only
    const list = byJob.get(r.jobName) ?? [];
    list.push(r);
    byJob.set(r.jobName, list);
  }
  const out: OwnerItem[] = [];
  for (const [job, list] of byJob) {
    list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const latest = list[0];
    if (isHardFailure(latest.status)) {
      // The streak began at the oldest failure not followed by a success.
      let firstFail = latest;
      for (const r of list) {
        if (!isHardFailure(r.status)) break;
        firstFail = r;
      }
      out.push(
        item(now, {
          key: `cron-failed:${job}`,
          kind: "cron_failed",
          tone: "rose",
          title: `cron ${job} ${latest.status}`,
          detail: clip(latest.error) ?? "no error text recorded",
          since: firstFail.createdAt,
          href: "/system/crons",
          evidence: `cron_job_logs ${latest.id}`,
        }),
      );
      continue;
    }
    // A `partial` row the job itself DECLARED degraded (cron-lifecycle writes the
    // declared-degradation prefix: the brief's compose timeout) is something the
    // owner should see today. A plain `partial` is a fan-out parent whose children
    // failed — mega-evening alone has written 1,248 of them — and that chronic
    // pattern is owned by diagnose-cron-failure, so it is not paged here.
    if (isDeclaredDegradation(latest.status, latest.error)) {
      out.push(
        item(now, {
          key: `cron-degraded:${job}`,
          kind: "cron_degraded",
          tone: "amber",
          title: `cron ${job} ran degraded`,
          detail: clip(declaredDegradationReason(latest.error ?? "")) ?? "degraded; no reason recorded",
          since: latest.createdAt,
          href: "/system/crons",
          evidence: `cron_job_logs ${latest.id}`,
        }),
      );
      continue;
    }
    const skipped = list.filter((r) => r.skipReason);
    if (skipped.length === list.length && list.length >= SKIP_STREAK_MIN) {
      out.push(
        item(now, {
          key: `cron-skipping:${job}`,
          kind: "cron_skipping",
          tone: "amber",
          title: `cron ${job} skipped all ${list.length} runs in 24h`,
          detail: clip(latest.skipReason),
          since: list[list.length - 1].createdAt,
          href: "/system/crons",
          evidence: `cron_job_logs ${latest.id}`,
        }),
      );
    }
  }
  return out;
}

/** railway:deploy:<id>:<STATUS> | railway:alert:<sha> -> a readable title. */
export function describePage(operationKey: string): string {
  const deploy = /^railway:deploy:(.+):([A-Z_]+)$/.exec(operationKey);
  if (deploy) {
    const id = deploy[1].startsWith("body-") ? "unknown deployment" : deploy[1].slice(0, 8);
    return `deploy ${deploy[2].toLowerCase()} · ${id}`;
  }
  if (operationKey.startsWith("railway:alert:")) return "railway resource alert";
  return "railway page";
}

export function composeOwnerPanel(input: OwnerPanelInput): OwnerPanel {
  const { now } = input;
  const unreadable: string[] = [];
  const exceptions: OwnerItem[] = [];
  const decisions: OwnerItem[] = [];

  if (input.cronRows === null) unreadable.push("cron runs");
  else exceptions.push(...cronExceptions(input.cronRows, now));

  if (input.deployPages === null) unreadable.push("deploy pages");
  else
    for (const p of input.deployPages) {
      // Only a settled success is "delivered". EXECUTING (the settle never landed) and
      // UNKNOWN say nothing about the phone, so they are unconfirmed, not delivered.
      const delivered = DELIVERED_STATES.has(p.state);
      const failed = p.state === "FAILED";
      exceptions.push(
        item(now, {
          key: `page:${p.id}`,
          kind: "deploy_page",
          // A delivered page already reached the owner's phone; it stays listed for the
          // window (no success event is recorded to clear it) but is amber, not red.
          tone: delivered ? "amber" : "rose",
          title: failed
            ? `${describePage(p.operationKey)} · page NOT delivered`
            : delivered
              ? describePage(p.operationKey)
              : `${describePage(p.operationKey)} · delivery unconfirmed`,
          detail: failed ? clip(p.reason) : delivered ? "paged to Telegram" : `page attempt is ${p.state}; no delivery was recorded`,
          since: p.startedAt,
          href: "/system/health",
          evidence: `action_attempts ${p.operationKey}`,
        }),
      );
    }

  if (input.outboxHealth === null) {
    unreadable.push("chat outbox");
  } else if (input.outboxHealth.dead > 0) {
    const rawOldest = input.outboxHealth.oldestDeadAt
      ? new Date(input.outboxHealth.oldestDeadAt)
      : null;
    const oldest =
      rawOldest && Number.isFinite(rawOldest.getTime()) ? rawOldest : null;
    exceptions.push(
      item(now, {
        key: "outbox:dead",
        kind: "outbox_dead",
        tone: "rose",
        title: `${input.outboxHealth.dead} chat background ${input.outboxHealth.dead === 1 ? "item" : "items"} dead-lettered`,
        detail:
          clip(input.outboxHealth.lastDeadError) ??
          "dead-letter queue needs review or redrive",
        since: oldest,
        href: "/system/health",
        evidence: "post_turn_outbox status=dead|failed",
      }),
    );
  }

  if (input.actionAttempts === null) {
    unreadable.push("action attempts");
  } else {
    for (const attempt of input.actionAttempts) {
      const evidence = `action_attempts ${attempt.id}`;
      if (attempt.state === "WAITING_APPROVAL") {
        decisions.push(
          item(now, {
            key: `attempt:${attempt.id}`,
            kind: "approval",
            tone: "neutral",
            title: `approve ${attempt.tool}?`,
            detail:
              clip(attempt.reason) ??
              `${attempt.effectClass} · ${clip(attempt.operationKey, 100) ?? attempt.operationKey}`,
            since: attempt.startedAt,
            href: "/system/actions",
            evidence,
          }),
        );
        continue;
      }

      if (attempt.state === "UNKNOWN") {
        exceptions.push(
          item(now, {
            key: `attempt-unknown:${attempt.id}`,
            kind: "action_unknown",
            tone: "rose",
            title: `${attempt.tool} outcome unknown`,
            detail:
              clip(attempt.reason) ??
              "operation may or may not have committed; reconcile before retry",
            since: attempt.settledAt ?? attempt.updatedAt ?? attempt.startedAt,
            href: "/system/logs",
            evidence,
          }),
        );
        continue;
      }

      if (attempt.state === "FAILED") {
        exceptions.push(
          item(now, {
            key: `attempt-failed:${attempt.id}`,
            kind: "action_failed",
            tone: "rose",
            title: `${attempt.tool} failed`,
            detail: clip(attempt.reason) ?? clip(attempt.operationKey),
            since: attempt.settledAt ?? attempt.updatedAt ?? attempt.startedAt,
            href: "/system/logs",
            evidence,
          }),
        );
        continue;
      }

      if (
        attempt.state === "EXECUTING" &&
        now.getTime() - attempt.startedAt.getTime() >=
          ACTION_EXECUTION_STALE_MS
      ) {
        exceptions.push(
          item(now, {
            key: `attempt-stalled:${attempt.id}`,
            kind: "action_stalled",
            tone: "amber",
            title: `${attempt.tool} still executing after 30m`,
            detail: clip(attempt.reason) ?? clip(attempt.operationKey),
            since: attempt.startedAt,
            href: "/system/logs",
            evidence,
          }),
        );
      }
    }
  }

  if (input.pendingActions === null || input.approvalRequests === null || input.expiredRequests === null)
    unreadable.push("approvals");
  else {
    // Expired approvals roll up to ONE row (same shape as Home's judgment queue):
    // they need a re-request or a dismissal, and a backlog must not bury the rest.
    let expiredCount = input.expiredRequests.count;
    let oldestExpired = input.expiredRequests.oldest?.getTime() ?? Infinity;
    const noteExpired = (at: Date) => {
      expiredCount++;
      oldestExpired = Math.min(oldestExpired, at.getTime());
    };
    for (const a of input.pendingActions) {
      if (a.expired) {
        noteExpired(a.createdAt);
        continue;
      }
      decisions.push(
        item(now, {
          key: `action:${a.id}`,
          kind: "approval",
          tone: "neutral",
          title: `approve ${a.actionType}?`,
          detail: `rule ${a.ruleName}`,
          since: a.createdAt,
          href: "/system/actions",
          evidence: `autonomous_actions ${a.id}`,
        }),
      );
    }
    for (const r of input.approvalRequests) {
      // Expired between the read and now: count it, do not offer it as a decision.
      if (r.expiresAt.getTime() <= now.getTime()) {
        noteExpired(r.createdAt);
        continue;
      }
      decisions.push(
        item(now, {
          key: `request:${r.id}`,
          kind: "approval",
          tone: "neutral",
          title: `approve ${r.actionType}?`,
          detail: clip(r.reason),
          since: r.createdAt,
          href: "/system/actions",
          evidence: `approval_requests ${r.id}`,
        }),
      );
    }
    if (expiredCount > 0)
      exceptions.push(
        item(now, {
          key: "approvals-expired",
          kind: "approval_expired",
          tone: "amber",
          title: `${expiredCount} ${expiredCount === 1 ? "approval" : "approvals"} expired unanswered`,
          detail: "each needs a re-request or a dismissal",
          since: Number.isFinite(oldestExpired) ? new Date(oldestExpired) : null,
          href: "/system/actions",
          evidence: "autonomous_actions + approval_requests past their freshness window",
        }),
      );
  }

  if (input.commitments === null) unreadable.push("commitments");
  else
    for (const c of input.commitments) {
      if (!c.deadline || !/^\d{4}-\d{2}-\d{2}$/.test(c.deadline) || c.deadline >= input.todayYmd) continue;
      exceptions.push(
        item(now, {
          key: `commitment:${c.id}`,
          kind: "commitment_overdue",
          tone: "amber",
          title: `overdue commitment${c.toWhom && c.toWhom !== "self" ? ` to ${c.toWhom}` : ""}`,
          detail: `${clip(c.description, 100)} · due ${c.deadline}`,
          // A deadline is a date: the commitment went overdue at the start of the next ET day.
          since: endOfDayET(new Date(`${c.deadline}T12:00:00Z`)),
          href: null,
          evidence: `commitments #${c.id}`,
        }),
      );
    }

  if (input.lanes === null) unreadable.push("lane budgets");
  else
    for (const l of input.lanes) {
      if (!l.over || l.capCents == null) continue;
      exceptions.push(
        item(now, {
          key: `lane:${l.feature}`,
          kind: "lane_stopped",
          tone: "rose",
          title: `AI lane ${l.feature} stopped · over its cap`,
          detail: `${dollars(l.spentCents)} of ${dollars(l.capCents)} today · calls return nothing until midnight ET`,
          since: null,
          href: "/system/ai-cost",
          evidence: `ai_generations feature=${l.feature} today`,
        }),
      );
    }

  if (input.capabilities === null) unreadable.push("capabilities");
  else
    for (const c of input.capabilities) {
      // A row nothing touched for a week is history: the capability stopped being
      // called, or the process that would recover it never ran. Not a live exception.
      if (now.getTime() - c.updatedAt.getTime() > CAPABILITY_WINDOW_MS) continue;
      const meta = isRecord(c.metadata) ? c.metadata : {};
      const lastError = typeof meta.lastError === "string" ? meta.lastError : null;
      const lastCategory = typeof meta.lastCategory === "string" ? meta.lastCategory : null;
      exceptions.push(
        item(now, {
          key: `capability:${c.name}`,
          kind: "capability_degraded",
          tone: c.status === "failed" ? "rose" : "amber",
          title: `capability ${c.name} ${c.status} · ${c.consecutiveFailures} consecutive ${c.consecutiveFailures === 1 ? "failure" : "failures"}`,
          detail: clip(lastError) ?? (lastCategory ? `last failure class: ${lastCategory}` : "no error text recorded"),
          since: parseIso(meta.firstFailureAt) ?? c.updatedAt,
          href: "/system/tools",
          evidence: `integrations name=${c.name}`,
        }),
      );
    }

  // Oldest first: the thing that has waited longest is the one being dropped.
  const byAge = (a: OwnerItem, b: OwnerItem) => (b.ageMin ?? -1) - (a.ageMin ?? -1);
  const rank = { rose: 0, amber: 1, neutral: 2 } as const;
  exceptions.sort((a, b) => rank[a.tone] - rank[b.tone] || byAge(a, b));
  decisions.sort(byAge);

  if (input.spend === null) unreadable.push("AI spend");
  if (input.tasksDone === null) unreadable.push("completed tasks");
  if (input.valueAttribution === null) unreadable.push("value attribution");
  const cost = costTiles(input.spend, input.tasksDone, input.valueAttribution);

  const n = exceptions.length;
  const d = decisions.length;
  let state: OwnerPanel["state"];
  let headline: string;
  if (n > 0) {
    state = "attention";
    headline = `${n} ${n === 1 ? "exception needs" : "exceptions need"} you`;
  } else if (unreadable.length > 0) {
    state = "unknown";
    headline = `nothing found · ${unreadable.length} ${unreadable.length === 1 ? "source" : "sources"} unreadable`;
  } else {
    state = "clear";
    headline = d > 0 ? "no exceptions" : "nothing needs you";
  }

  return {
    state,
    headline,
    exceptions,
    decisions: decisions.slice(0, DECISIONS_VISIBLE_CAP),
    decisionsHidden: Math.max(0, d - DECISIONS_VISIBLE_CAP),
    cost,
    unreadable,
    generatedAt: now.toISOString(),
  };
}

export function costTiles(
  spend: SpendLite | null,
  tasksDone: number | null,
  valueAttribution: ValueAttributionLite | null,
): CostTile[] {
  const w = `${COST_WINDOW_DAYS}d`;
  const tiles: CostTile[] = [];

  if (spend === null) {
    tiles.push({ key: "ai_spend", label: `AI spend · ${w}`, value: null, provenance: "UNMEASURED", note: "the ai_generations read failed" });
  } else {
    const floor = spend.unpricedCalls > 0;
    tiles.push({
      key: "ai_spend",
      label: `AI spend · ${w}`,
      value: `${floor ? "≥ " : ""}${dollars(spend.costCents)}`,
      provenance: "MEASURED",
      note: floor
        ? `${spend.calls} calls; ${spend.unpricedCalls} carry no cost, so this is a floor`
        : `${spend.calls} calls, every one priced`,
    });
  }

  if (tasksDone === null) {
    tiles.push({ key: "tasks_done", label: `tasks completed · ${w}`, value: null, provenance: "UNMEASURED", note: "the tasks read failed" });
  } else {
    tiles.push({
      key: "tasks_done",
      label: `tasks completed · ${w}`,
      value: String(tasksDone),
      provenance: "ESTIMATE",
      note: "DONE tasks by last update — the table stores no completion time",
    });
  }

  let perTask: CostTile;
  if (spend === null || tasksDone === null) {
    perTask = { key: "per_task", label: "AI spend per completed task", value: null, provenance: "UNMEASURED", note: "an input read failed" };
  } else if (tasksDone === 0) {
    perTask = { key: "per_task", label: "AI spend per completed task", value: null, provenance: "UNMEASURED", note: `no task completed in ${w}; a ratio over zero outcomes is not a number` };
  } else {
    perTask = {
      key: "per_task",
      label: "AI spend per completed task",
      value: `${spend.unpricedCalls > 0 ? "≥ " : ""}${dollars(Math.round(spend.costCents / tasksDone))}`,
      provenance: "ESTIMATE",
      note: "all AI spend over all completed tasks — spend is not attributed to tasks",
    };
  }
  tiles.push(perTask);

  tiles.push({
    key: "per_lane",
    label: "AI spend per lane outcome",
    value: null,
    provenance: "UNMEASURED",
    note: "lanes record spend (ai_generations.feature) but no outcome; spend per lane is on /system/ai-cost",
  });
  let recoveredRevenue: CostTile;
  if (valueAttribution === null) {
    recoveredRevenue = {
      key: "recovered_revenue",
      label: "SMS + voice cost vs recovered revenue",
      value: null,
      provenance: "UNMEASURED",
      note: "the value-attribution read failed",
    };
  } else if (
    valueAttribution.measurementState === "MEASURED" &&
    valueAttribution.matchedRefs > 0
  ) {
    const perOutcome =
      valueAttribution.costPerRecoveredOutcomeCents === null
        ? "outcome count unmeasured"
        : `${dollars(valueAttribution.costPerRecoveredOutcomeCents)}/recovered outcome`;
    const ratio =
      valueAttribution.recoveredRevenuePerSendCostDollar === null
        ? "ratio unmeasured"
        : `${valueAttribution.recoveredRevenuePerSendCostDollar.toFixed(1)}× recovered revenue / send-cost dollar`;
    recoveredRevenue = {
      key: "recovered_revenue",
      label: "SMS + voice cost vs recovered revenue",
      value: `${dollars(valueAttribution.matchedMeasuredCostCents)} → ${dollars(valueAttribution.matchedMeasuredRecoveredRevenueCents)}`,
      provenance: "MEASURED",
      note: `${valueAttribution.matchedRefs} matched attribution ref${valueAttribution.matchedRefs === 1 ? "" : "s"} · ${perOutcome} · ${ratio}`,
    };
  } else if (valueAttribution.measurementState === "ESTIMATE") {
    // Each side sums its measured and estimated money: nothing joined, but a measured amount is
    // still real money on its side. A side with nothing recorded says so; "~$0.00" would read as free.
    const costCents =
      (valueAttribution.measuredSendCostCents ?? 0) + valueAttribution.estimatedSendCostCents;
    const revenueCents =
      (valueAttribution.measuredRecoveredRevenueCents ?? 0) +
      valueAttribution.estimatedRecoveredRevenueCents;
    recoveredRevenue = {
      key: "recovered_revenue",
      label: "SMS + voice cost vs recovered revenue",
      value:
        costCents > 0 || revenueCents > 0
          ? `${costCents > 0 ? `~${dollars(costCents)}` : "no cost recorded"} → ${revenueCents > 0 ? `~${dollars(revenueCents)}` : "no revenue recorded"}`
          : null,
      provenance: "ESTIMATE",
      note:
        "estimate observations exist, but no measured holdout-adjusted cost/revenue join exists; no ROI is claimed",
    };
  } else {
    recoveredRevenue = {
      key: "recovered_revenue",
      label: "SMS + voice cost vs recovered revenue",
      value: null,
      provenance: "UNMEASURED",
      note:
        valueAttribution.reasons.join("; ") ||
        "no measured matched cost/revenue observation exists",
    };
  }
  tiles.push(recoveredRevenue);
  return tiles;
}
