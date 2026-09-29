/**
 * tests/lib/system/owner-panel.test.ts · 2026-09-23 · Q-24
 *
 * The owner panel lists only what needs the owner. Pinned here: a failed read
 * is never a clear (empty-vs-error), a job whose latest run worked fades, a
 * job that skipped every run surfaces with its reason, expired approvals are
 * exceptions while live ones are decisions, and a cost tile with no
 * measurement is UNMEASURED with a null value — never a zero.
 */
import { describe, expect, it } from "vitest";

import {
  composeOwnerPanel,
  cronExceptions,
  describePage,
  type CronRow,
  type OwnerPanelInput,
} from "@/lib/system/owner-panel";

const now = new Date("2026-09-23T16:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

const clean: OwnerPanelInput = {
  now,
  todayYmd: "2026-09-23",
  cronRows: [],
  deployPages: [],
  pendingActions: [],
  approvalRequests: [],
  expiredRequests: { count: 0, oldest: null },
  commitments: [],
  lanes: [],
  outboxHealth: {
    pending: 0,
    processing: 0,
    done24h: 0,
    dead: 0,
    oldestDeadAt: null,
    lastDeadError: null,
  },
  actionAttempts: [],
  spend: { costCents: 1234, calls: 40, unpricedCalls: 0 },
  tasksDone: 4,
};

const run = (jobName: string, status: string, min: number, extra: Partial<CronRow> = {}): CronRow => ({
  id: `${jobName}-${min}`,
  jobName,
  status,
  error: null,
  skipReason: null,
  createdAt: ago(min),
  ...extra,
});

describe("composeOwnerPanel · verdict", () => {
  it("is CLEAR only when every source read and nothing needs the owner", () => {
    const p = composeOwnerPanel(clean);
    expect(p.state).toBe("clear");
    expect(p.headline).toBe("nothing needs you");
    expect(p.unreadable).toEqual([]);
  });

  it("is UNKNOWN, not clear, when a source failed and nothing was found", () => {
    const p = composeOwnerPanel({ ...clean, cronRows: null, deployPages: null });
    expect(p.state).toBe("unknown");
    expect(p.unreadable).toEqual(["cron runs", "deploy pages"]);
    expect(p.headline).toMatch(/2 sources unreadable/);
  });

  it("names approvals as unreadable when either approval read failed", () => {
    expect(composeOwnerPanel({ ...clean, approvalRequests: null }).unreadable).toContain("approvals");
    expect(composeOwnerPanel({ ...clean, pendingActions: null }).unreadable).toContain("approvals");
    expect(composeOwnerPanel({ ...clean, expiredRequests: null }).unreadable).toContain("approvals");
  });

  it("is ATTENTION with a count when exceptions exist, and still lists unreadable sources", () => {
    const p = composeOwnerPanel({ ...clean, lanes: null, cronRows: [run("sync", "failed", 30, { error: "boom" })] });
    expect(p.state).toBe("attention");
    expect(p.headline).toBe("1 exception needs you");
    expect(p.unreadable).toEqual(["lane budgets"]);
  });
});

describe("cronExceptions · healthy fades", () => {
  it("drops a job whose latest run succeeded after an earlier failure", () => {
    expect(cronExceptions([run("a", "success", 5), run("a", "failed", 60)], now)).toEqual([]);
  });

  it("reports a failure streak from its first failure, with the error text", () => {
    const [e] = cronExceptions([run("a", "failed", 5, { error: "db timeout" }), run("a", "interrupted", 60), run("a", "success", 120)], now);
    expect(e.kind).toBe("cron_failed");
    expect(e.detail).toBe("db timeout");
    expect(e.ageMin).toBe(60);
    expect(e.href).toBe("/system/crons");
    expect(e.evidence).toBe("cron_job_logs a-5");
  });

  it("ignores started / duplicate rows — they witness invocation, not outcome", () => {
    expect(cronExceptions([run("a", "started", 1), run("a", "duplicate", 2), run("a", "success", 10)], now)).toEqual([]);
  });

  it("surfaces a job that skipped every run in the window, with the latest reason", () => {
    const [e] = cronExceptions(
      [run("b", "success", 5, { skipReason: "gateway offline" }), run("b", "success", 65, { skipReason: "flag off" })],
      now,
    );
    expect(e.kind).toBe("cron_skipping");
    expect(e.detail).toBe("gateway offline");
    expect(e.ageMin).toBe(65);
  });

  it("does not surface a single skip, or a job that also did work", () => {
    expect(cronExceptions([run("b", "success", 5, { skipReason: "outside window" })], now)).toEqual([]);
    expect(cronExceptions([run("b", "success", 5, { skipReason: "x" }), run("b", "success", 65)], now)).toEqual([]);
  });
});

describe("approvals · live is a decision, expired is an exception", () => {
  it("splits pending actions and approval requests by expiry", () => {
    const p = composeOwnerPanel({
      ...clean,
      pendingActions: [
        { id: "a1", ruleName: "r", actionType: "send_sms", createdAt: ago(120), expired: false },
        { id: "a2", ruleName: "r", actionType: "publish", createdAt: ago(20_000), expired: true },
      ],
      approvalRequests: [
        { id: "q1", actionType: "browser", reason: "why", createdAt: ago(30), expiresAt: new Date(now.getTime() + 60_000) },
        { id: "q2", actionType: "browser", reason: "old", createdAt: ago(3000), expiresAt: ago(10) },
      ],
    });
    expect(p.decisions.map((d) => d.key)).toEqual(["action:a1", "request:q1"]); // oldest first
    // Expired approvals roll up into ONE exception, aged from the oldest.
    expect(p.exceptions).toHaveLength(1);
    expect(p.exceptions[0]).toMatchObject({ kind: "approval_expired", title: "2 approvals expired unanswered", ageMin: 20_000 });
    expect(p.decisions.every((d) => d.href === "/system/actions")).toBe(true);
  });

  it("an expired backlog cannot hide live decisions or flood the exceptions (Codex P1 on #2645)", () => {
    const p = composeOwnerPanel({
      ...clean,
      approvalRequests: [{ id: "live", actionType: "browser", reason: "r", createdAt: ago(5), expiresAt: new Date(now.getTime() + 60_000) }],
      expiredRequests: { count: 150, oldest: ago(50_000) },
    });
    expect(p.decisions.map((d) => d.key)).toEqual(["request:live"]);
    expect(p.exceptions).toHaveLength(1);
    expect(p.exceptions[0]).toMatchObject({ title: "150 approvals expired unanswered", ageMin: 50_000 });
  });

  it("caps visible decisions and reports how many are hidden", () => {
    const pendingActions = Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, ruleName: "r", actionType: "t", createdAt: ago(i), expired: false }));
    const p = composeOwnerPanel({ ...clean, pendingActions });
    expect(p.decisions).toHaveLength(5);
    expect(p.decisionsHidden).toBe(3);
    expect(p.headline).toBe("no exceptions");
  });
});

describe("other exception sources", () => {
  it("lists an overdue commitment and ignores one due today or with a free-text deadline", () => {
    const p = composeOwnerPanel({
      ...clean,
      commitments: [
        { id: 1, description: "call Dania", deadline: "2026-09-21", toWhom: "Dania" },
        { id: 2, description: "today", deadline: "2026-09-23", toWhom: "self" },
        { id: 3, description: "vague", deadline: "next week", toWhom: "self" },
      ],
    });
    expect(p.exceptions).toHaveLength(1);
    expect(p.exceptions[0].title).toBe("overdue commitment to Dania");
    expect(p.exceptions[0].evidence).toBe("commitments #1");
  });

  it("lists a capped lane that is over its cap, not an uncapped spender", () => {
    const p = composeOwnerPanel({
      ...clean,
      lanes: [
        { feature: "chat", spentCents: 600, capCents: 500, over: true },
        { feature: "brain", spentCents: 9000, capCents: null, over: false },
      ],
    });
    expect(p.exceptions.map((e) => e.key)).toEqual(["lane:chat"]);
    // startOfDay() is ET midnight (lib/utils/datetime.ts) — the reset time must say so (Codex P2 on #2645).
    expect(p.exceptions[0].detail).toMatch(/until midnight ET$/);
  });

  it("marks an undelivered deploy page, and sorts rose before amber", () => {
    const p = composeOwnerPanel({
      ...clean,
      commitments: [{ id: 1, description: "x", deadline: "2026-09-01", toWhom: "self" }],
      deployPages: [{ id: "p1", operationKey: "railway:deploy:abcdef123456:FAILED", state: "FAILED", reason: "sendTelegram returned false", startedAt: ago(15) }],
    });
    expect(p.exceptions[0].title).toBe("deploy failed · abcdef12 · page NOT delivered");
    expect(p.exceptions[1].kind).toBe("commitment_overdue");
  });

  it("describes resource alerts and bodies with no deployment id", () => {
    expect(describePage("railway:alert:deadbeef")).toBe("railway resource alert");
    const delivered = composeOwnerPanel({
      ...clean,
      deployPages: [{ id: "p2", operationKey: "railway:deploy:abc12345:CRASHED", state: "SUCCEEDED_UNVERIFIED", reason: null, startedAt: ago(5) }],
    }).exceptions[0];
    expect(delivered).toMatchObject({ tone: "amber", title: "deploy crashed · abc12345", detail: "paged to Telegram" });
  });

  it("does not call an unsettled page delivered (Codex P2 on #2645)", () => {
    for (const state of ["EXECUTING", "UNKNOWN"]) {
      const [e] = composeOwnerPanel({
        ...clean,
        deployPages: [{ id: "p3", operationKey: "railway:deploy:abc12345:FAILED", state, reason: null, startedAt: ago(5) }],
      }).exceptions;
      expect(e.tone).toBe("rose");
      expect(e.title).toBe("deploy failed · abc12345 · delivery unconfirmed");
      expect(e.detail).not.toMatch(/paged to Telegram/);
    }
    expect(describePage("railway:deploy:body-0123:CRASHED")).toBe("deploy crashed · unknown deployment");
  });
});

describe("durable exception consolidation", () => {
  it("rolls dead post-turn work into one actionable exception", () => {
    const p = composeOwnerPanel({
      ...clean,
      outboxHealth: {
        pending: 3,
        processing: 1,
        done24h: 40,
        dead: 4,
        oldestDeadAt: ago(180).toISOString(),
        lastDeadError: "memory projection failed after five attempts",
      },
    });

    expect(p.exceptions).toHaveLength(1);
    expect(p.exceptions[0]).toMatchObject({
      key: "outbox:dead",
      kind: "outbox_dead",
      tone: "rose",
      title: "4 chat background items dead-lettered",
      detail: "memory projection failed after five attempts",
      ageMin: 180,
      href: "/system/health",
    });
  });

  it("treats an unreadable outbox as UNKNOWN, never an empty queue", () => {
    const p = composeOwnerPanel({ ...clean, outboxHealth: null });
    expect(p.state).toBe("unknown");
    expect(p.unreadable).toContain("chat outbox");
    expect(p.exceptions).toEqual([]);
  });

  it("surfaces failed/unknown/stalled action attempts while fresh execution stays quiet", () => {
    const p = composeOwnerPanel({
      ...clean,
      actionAttempts: [
        {
          id: "unknown-1",
          operationKey: "shop:sms:42",
          tool: "shop.sendSms",
          effectClass: "write",
          state: "UNKNOWN",
          reason: null,
          startedAt: ago(60),
          settledAt: ago(40),
          updatedAt: ago(40),
        },
        {
          id: "failed-1",
          operationKey: "calendar:create:7",
          tool: "calendar.create",
          effectClass: "write",
          state: "FAILED",
          reason: "provider rejected request",
          startedAt: ago(25),
          settledAt: ago(20),
          updatedAt: ago(20),
        },
        {
          id: "fresh-1",
          operationKey: "slow:but-normal",
          tool: "document.ingest",
          effectClass: "write",
          state: "EXECUTING",
          reason: null,
          startedAt: ago(10),
          settledAt: null,
          updatedAt: ago(1),
        },
        {
          id: "stale-1",
          operationKey: "stuck:operation",
          tool: "github.create_pr",
          effectClass: "write",
          state: "EXECUTING",
          reason: null,
          startedAt: ago(45),
          settledAt: null,
          updatedAt: ago(45),
        },
      ],
    });

    expect(p.exceptions.map((e) => e.kind)).toEqual([
      "action_unknown",
      "action_failed",
      "action_stalled",
    ]);
    expect(p.exceptions[0]).toMatchObject({
      title: "shop.sendSms outcome unknown",
      tone: "rose",
      ageMin: 40,
    });
    expect(p.exceptions[1]).toMatchObject({
      title: "calendar.create failed",
      detail: "provider rejected request",
      tone: "rose",
    });
    expect(p.exceptions[2]).toMatchObject({
      title: "github.create_pr still executing after 30m",
      tone: "amber",
      ageMin: 45,
    });
    expect(p.exceptions.some((e) => e.key.includes("fresh-1"))).toBe(false);
  });

  it("joins ActionAttempt WAITING_APPROVAL into the existing decision list", () => {
    const p = composeOwnerPanel({
      ...clean,
      actionAttempts: [
        {
          id: "wait-1",
          operationKey: "gmail:send:abc",
          tool: "gmail.send",
          effectClass: "write",
          state: "WAITING_APPROVAL",
          reason: "external message requires owner approval",
          startedAt: ago(90),
          settledAt: null,
          updatedAt: ago(90),
        },
      ],
    });

    expect(p.exceptions).toEqual([]);
    expect(p.decisions).toEqual([
      expect.objectContaining({
        key: "attempt:wait-1",
        kind: "approval",
        title: "approve gmail.send?",
        href: "/system/actions",
        evidence: "action_attempts wait-1",
      }),
    ]);
  });

  it("makes action-attempt read failure explicit instead of clearing decisions", () => {
    const p = composeOwnerPanel({ ...clean, actionAttempts: null });
    expect(p.state).toBe("unknown");
    expect(p.unreadable).toContain("action attempts");
  });
});

describe("cost per outcome · never a zero for an unknown", () => {
  const tile = (p: ReturnType<typeof composeOwnerPanel>, key: string) => p.cost.find((t) => t.key === key)!;

  it("measures spend, estimates tasks and the ratio, and leaves lane/revenue UNMEASURED", () => {
    const p = composeOwnerPanel(clean);
    expect(tile(p, "ai_spend")).toMatchObject({ value: "$12.34", provenance: "MEASURED" });
    expect(tile(p, "tasks_done")).toMatchObject({ value: "4", provenance: "ESTIMATE" });
    expect(tile(p, "per_task")).toMatchObject({ value: "$3.09", provenance: "ESTIMATE" });
    expect(tile(p, "per_lane")).toMatchObject({ value: null, provenance: "UNMEASURED" });
    expect(tile(p, "recovered_revenue")).toMatchObject({ value: null, provenance: "UNMEASURED" });
  });

  it("states spend as a floor when some calls carry no cost", () => {
    const p = composeOwnerPanel({ ...clean, spend: { costCents: 100, calls: 10, unpricedCalls: 3 } });
    expect(tile(p, "ai_spend").value).toBe("≥ $1.00");
    expect(tile(p, "per_task").value).toBe("≥ $0.25");
  });

  it("refuses a ratio over zero outcomes", () => {
    const p = composeOwnerPanel({ ...clean, tasksDone: 0 });
    expect(tile(p, "per_task")).toMatchObject({ value: null, provenance: "UNMEASURED" });
  });

  it("renders a failed spend read as UNMEASURED with null, and names it", () => {
    const p = composeOwnerPanel({ ...clean, spend: null });
    expect(tile(p, "ai_spend")).toMatchObject({ value: null, provenance: "UNMEASURED" });
    expect(tile(p, "per_task").value).toBeNull();
    expect(p.unreadable).toContain("AI spend");
    expect(p.state).toBe("unknown");
  });
});
