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
 *                         past its cap is STOPPED until midnight UTC
 *   · cost             -> ai_generations cost_cents, tasks marked DONE
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

import { isHardFailure } from "@/lib/services/cron-control";
import { endOfDayET } from "@/lib/utils/datetime";

export const EXCEPTION_WINDOW_MS = 24 * 60 * 60_000;
export const COST_WINDOW_DAYS = 7;
/** A job must have skipped at least this many runs in the window, and done nothing else, to page the owner. */
export const SKIP_STREAK_MIN = 2;
export const DECISIONS_VISIBLE_CAP = 5;
export const DEPLOY_ALERT_TOOL = "railway.deploy_alert";

const TERMINAL = new Set(["success", "partial", "failed", "interrupted"]);

export type Provenance = "MEASURED" | "ESTIMATE" | "UNMEASURED";

export interface OwnerItem {
  key: string;
  kind: "cron_failed" | "cron_skipping" | "deploy_page" | "approval_expired" | "commitment_overdue" | "lane_stopped" | "approval";
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

/** null = that read FAILED. [] / 0 = it succeeded and found nothing. */
export interface OwnerPanelInput {
  now: Date;
  /** Today in ET, YYYY-MM-DD — commitment deadlines are ET calendar dates. */
  todayYmd: string;
  cronRows: CronRow[] | null;
  deployPages: PageRow[] | null;
  pendingActions: PendingActionLite[] | null;
  approvalRequests: ApprovalRequestLite[] | null;
  commitments: CommitmentLite[] | null;
  lanes: LaneLite[] | null;
  spend: SpendLite | null;
  tasksDone: number | null;
}

const clip = (s: string | null | undefined, n = 140): string | null => {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

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
      const undelivered = p.state === "FAILED";
      exceptions.push(
        item(now, {
          key: `page:${p.id}`,
          kind: "deploy_page",
          // A delivered page already reached the owner's phone; it stays listed for the
          // window (no success event is recorded to clear it) but only an undelivered one is red.
          tone: undelivered ? "rose" : "amber",
          title: undelivered ? `${describePage(p.operationKey)} · page NOT delivered` : describePage(p.operationKey),
          detail: undelivered ? clip(p.reason) : "paged to Telegram",
          since: p.startedAt,
          href: "/system/health",
          evidence: `action_attempts ${p.operationKey}`,
        }),
      );
    }

  if (input.pendingActions === null || input.approvalRequests === null) unreadable.push("approvals");
  else {
    for (const a of input.pendingActions) {
      const row = {
        since: a.createdAt,
        href: "/system/actions",
        evidence: `autonomous_actions ${a.id}`,
        detail: `rule ${a.ruleName}`,
      };
      if (a.expired)
        exceptions.push(item(now, { ...row, key: `expired-action:${a.id}`, kind: "approval_expired", tone: "amber", title: `approval expired unanswered · ${a.actionType}`, detail: `${row.detail} · re-request or dismiss` }));
      else decisions.push(item(now, { ...row, key: `action:${a.id}`, kind: "approval", tone: "neutral", title: `approve ${a.actionType}?` }));
    }
    for (const r of input.approvalRequests) {
      const expired = r.expiresAt.getTime() <= now.getTime();
      const row = { since: r.createdAt, href: "/system/actions", evidence: `approval_requests ${r.id}`, detail: clip(r.reason) };
      if (expired)
        exceptions.push(item(now, { ...row, key: `expired-request:${r.id}`, kind: "approval_expired", tone: "amber", title: `approval expired unanswered · ${r.actionType}` }));
      else decisions.push(item(now, { ...row, key: `request:${r.id}`, kind: "approval", tone: "neutral", title: `approve ${r.actionType}?` }));
    }
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
          detail: `${dollars(l.spentCents)} of ${dollars(l.capCents)} today · calls return nothing until midnight UTC`,
          since: null,
          href: "/system/ai-cost",
          evidence: `ai_generations feature=${l.feature} today`,
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
  const cost = costTiles(input.spend, input.tasksDone);

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

export function costTiles(spend: SpendLite | null, tasksDone: number | null): CostTile[] {
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
  tiles.push({
    key: "recovered_revenue",
    label: "SMS + voice cost vs recovered revenue",
    value: null,
    provenance: "UNMEASURED",
    note: "needs the per-lane holdouts (Q-21) and nickstire's send costs, neither of which reaches statenour yet",
  });
  return tiles;
}
