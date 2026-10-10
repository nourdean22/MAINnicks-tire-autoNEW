/**
 * Task 12 follow-up: an approved action that MAY have run, or that failed, must
 * reach the owner.
 *
 * The approval sweeper now moves a stale `executing` approval to `needs_review`
 * (never re-run), and a tool that throws leaves the approval `failed`. Every
 * approval reader queried `pending_approval` only, so both outcomes were
 * invisible. The Owner Panel now lists them with the existing exception kinds:
 * `needs_review` -> action_unknown ("may have run, check before retrying"),
 * `failed` (24 h window) -> action_failed.
 *
 * Both halves are pinned: the composer (pure) and the reader that feeds it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  composeOwnerPanel,
  type ApprovalIssueLite,
  type OwnerPanelInput,
} from "@/lib/system/owner-panel";

const now = new Date("2026-10-10T16:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

const clean: OwnerPanelInput = {
  now,
  todayYmd: "2026-10-10",
  cronRows: [],
  deployPages: [],
  pendingActions: [],
  approvalRequests: [],
  expiredRequests: { count: 0, oldest: null },
  commitments: [],
  lanes: [],
  outboxHealth: { pending: 0, processing: 0, done24h: 0, dead: 0, oldestDeadAt: null, lastDeadError: null },
  actionAttempts: [],
  capabilities: [],
  spend: { costCents: 0, calls: 0, unpricedCalls: 0 },
  tasksDone: 0,
  valueAttribution: {
    measurementState: "UNMEASURED",
    matchedRefs: 0,
    matchedMeasuredCostCents: 0,
    matchedMeasuredRecoveredRevenueCents: 0,
    measuredRecoveredOutcomes: 0,
    costPerRecoveredOutcomeCents: null,
    recoveredRevenuePerSendCostDollar: null,
    estimatedSendCostCents: 0,
    estimatedRecoveredRevenueCents: 0,
    reasons: [],
  },
};

const issue = (id: string, status: string, min: number, error = "boom"): ApprovalIssueLite => ({
  id,
  toolId: "shop.sendSms",
  status,
  resultPayload: { error },
  updatedAt: ago(min),
});

describe("composeOwnerPanel: approvals that may have run or failed", () => {
  it("a needs_review approval is a rose exception that says it may have run", () => {
    const p = composeOwnerPanel({ ...clean, approvalIssues: [issue("ar1", "needs_review", 10, "did not finish within 5 minutes")] });

    expect(p.state).toBe("attention");
    expect(p.exceptions).toHaveLength(1);
    const e = p.exceptions[0];
    // href null: /system/actions lists pending_approval only; `evidence` names the row.
    expect(e).toMatchObject({ kind: "action_unknown", tone: "rose", href: null, evidence: "approval_requests ar1" });
    expect(e.title).toMatch(/shop\.sendSms/);
    expect(e.title).toMatch(/may have run/);
    expect(e.detail).toMatch(/check before retrying/);
  });

  it("a failed approval inside 24 h is an action_failed exception carrying its error", () => {
    const p = composeOwnerPanel({ ...clean, approvalIssues: [issue("ar2", "failed", 60, "Twilio 503")] });

    expect(p.exceptions).toHaveLength(1);
    expect(p.exceptions[0]).toMatchObject({ kind: "action_failed", tone: "rose", evidence: "approval_requests ar2" });
    expect(p.exceptions[0].detail).toMatch(/Twilio 503/);
  });

  it("a failed approval older than 24 h fades; a needs_review older than 7 days fades", () => {
    const p = composeOwnerPanel({
      ...clean,
      approvalIssues: [issue("old_fail", "failed", 25 * 60), issue("old_review", "needs_review", 8 * 24 * 60)],
    });

    expect(p.exceptions).toEqual([]);
    expect(p.state).toBe("clear");
  });

  it("an unreadable approval-outcome read is UNKNOWN, never clear", () => {
    const p = composeOwnerPanel({ ...clean, approvalIssues: null });

    expect(p.unreadable).toContain("approval outcomes");
    expect(p.state).toBe("unknown");
  });

  it("the approval's own ledger attempt (approval:<id>) is not listed a second time", () => {
    const p = composeOwnerPanel({
      ...clean,
      approvalIssues: [issue("ar3", "failed", 5)],
      actionAttempts: [
        {
          id: "att1",
          operationKey: "approval:ar3",
          tool: "shop.sendSms",
          effectClass: "write",
          state: "UNKNOWN",
          reason: "boom",
          startedAt: ago(6),
          settledAt: ago(5),
          updatedAt: ago(5),
        },
      ],
    });

    expect(p.exceptions).toHaveLength(1);
    expect(p.exceptions[0].evidence).toBe("approval_requests ar3");
  });
});

// -- the reader: buildOwnerPanel must actually read and pass the rows --

const { approvalFindMany } = vi.hoisted(() => ({ approvalFindMany: vi.fn() }));

vi.mock("@/lib/prisma", () => {
  const generic = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue({ _sum: { costCents: 0 }, _count: { _all: 0 }, _min: { createdAt: null } }),
  });
  return {
    prisma: new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop === "$queryRaw") return () => Promise.resolve([]);
          if (prop === "approvalRequest") return { ...generic(), findMany: (...a: unknown[]) => approvalFindMany(...a) };
          return generic();
        },
      },
    ),
  };
});
vi.mock("@/lib/automation/approval-queue", () => ({ listPendingActions: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/ai/budget", () => ({ listLaneStatus: vi.fn().mockResolvedValue({ lanes: [] }) }));
vi.mock("@/lib/services/chat/post-turn-outbox", () => ({
  getOutboxHealth: vi.fn().mockResolvedValue({ pending: 0, processing: 0, done24h: 0, dead: 0, oldestDeadAt: null, lastDeadError: null }),
}));
vi.mock("@/lib/intelligence/value-attribution", () => ({ buildCostPerOutcomeAttribution: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/db/migration-manifest", () => ({ REPO_MIGRATIONS: [] }));

describe("buildOwnerPanel: the reader feeds needs_review / failed approvals to the composer", () => {
  beforeEach(() => {
    approvalFindMany.mockReset();
    approvalFindMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      // The live-decision read filters status=pending_approval; the outcome read does not.
      if (args.where.status === "pending_approval") return [];
      return [{ id: "ar9", toolId: "shop.sendSms", status: "needs_review", resultPayload: { error: "stale" }, updatedAt: new Date() }];
    });
  });

  it("an approval in needs_review reaches the panel as an exception", async () => {
    const { buildOwnerPanel } = await import("@/lib/system/owner-panel-data");

    const p = await buildOwnerPanel();

    const row = p.exceptions.find((e) => e.evidence === "approval_requests ar9");
    expect(row?.kind).toBe("action_unknown");
    const outcomeRead = approvalFindMany.mock.calls.find((c) => (c[0] as { where: { status?: unknown } }).where.status !== "pending_approval");
    expect(JSON.stringify(outcomeRead?.[0])).toContain("needs_review");
    expect(JSON.stringify(outcomeRead?.[0])).toContain("failed");
  });
});
