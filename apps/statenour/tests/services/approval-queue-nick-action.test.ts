/**
 * decidePendingAction for a Nick Action Queue row (nick_action_*).
 *
 * THE DEFECT (prod, measured 2026-10-30): every nick_action row Nour approved in the app since
 * 2026-10-21 ended needs_review/failed with "rule ... not found in autonomous-engine RULES
 * registry" (35 rows, 0 executed). The in-app Approve ran executeApprovedAction, which only knows
 * autonomous-engine RULES. Nick actions have their own executor: Telegram /qa marks the row
 * approved with executedAt still null and emits `nick-action/approved`, and the shared batch core
 * (lib/ai/nick-action-batch.ts) claims and runs it; the 09:00Z cron is the backstop.
 *
 * The app's Approve now takes that same route. CONTROL: a RULES row still runs through
 * executeApprovedAction.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { id: string; ruleName: string; approval: string; executedAt: Date | null };

const h = vi.hoisted(() => {
  const rows = new Map<string, Row>();
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (row as Record<string, unknown>)[k] === v);
  const autonomousAction = {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const r = rows.get(where.id);
      return r ? { ...r } : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const r = rows.get(where.id);
      if (!r) throw new Error("P2025 record not found");
      Object.assign(r, data);
      return { ...r };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const r = rows.get(where.id as string);
      if (!r || !matches(r, where)) return { count: 0 };
      Object.assign(r, data);
      return { count: 1 };
    }),
  };
  const executeApprovedAction = vi.fn(async (_id: string) => ({ ok: true, result: "sent" }));
  const send = vi.fn(async (_e: unknown) => ({ ids: ["evt"] }));
  const flag = { isOn: true };
  const killed = vi.fn(async (_job: string) => false);
  const runBatch = vi.fn(async (_o: unknown) => ({ executed: 1, failed: 0, skipped: 0, results: [], telegramOk: true, total: 1 }));
  return { rows, autonomousAction, executeApprovedAction, send, flag, killed, runBatch };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    autonomousAction: h.autonomousAction,
    automationPolicy: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/brain/autonomous-engine", () => ({ executeApprovedAction: h.executeApprovedAction }));
vi.mock("@/lib/automation/policy", () => ({ getPolicy: vi.fn(async () => null), logPolicyFire: vi.fn() }));
vi.mock("@/lib/inngest/client", () => ({ getInngest: () => ({ send: h.send }) }));
vi.mock("@/lib/feature-flags", () => ({ getFlag: (key: string) => (key === "NICK_AUTONOMY" ? { isOn: h.flag.isOn } : null) }));
vi.mock("@/lib/inngest/cron-lifecycle", () => ({ isCronKilled: h.killed }));

import { decidePendingAction, NICK_ACTION_RUN_WINDOW_MS } from "@/lib/automation/approval-queue";

function seed(id: string, ruleName: string, actionType: string, createdAt = new Date()) {
  h.rows.set(id, {
    id,
    ruleName,
    trigger: "t",
    actionType,
    targetType: "task",
    targetId: "T1",
    payload: { reason: "r" },
    approval: "pending",
    approvedBy: null,
    result: null,
    error: null,
    executedAt: null,
    createdAt,
  });
}

beforeEach(() => {
  h.flag.isOn = true;
  h.rows.clear();
  h.executeApprovedAction.mockClear();
  h.send.mockClear();
  h.killed.mockReset();
  h.killed.mockResolvedValue(false);
  h.runBatch.mockClear();
});

describe("approving a Nick Action Queue row in the app", () => {
  it("hands it to the Nick action executor: approved, not executed yet, event sent, no RULES replay", async () => {
    seed("n1", "nick_action_commit_journal", "commit_journal");
    const out = await decidePendingAction("n1", "approved", "nour");

    expect(h.executeApprovedAction).not.toHaveBeenCalled();
    expect(h.rows.get("n1")).toEqual(expect.objectContaining({ approval: "approved", executedAt: null, error: null }));
    expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: "nick-action/approved", data: expect.objectContaining({ actionIds: ["n1"] }) }),
    );
    expect(out.executedAt).toBeNull();
  });

  it("stays approved for the 09:00Z backstop when the event cannot be sent", async () => {
    seed("n2", "nick_action_reassign_inbox", "reassign_task");
    h.send.mockRejectedValueOnce(new Error("inngest down"));
    await decidePendingAction("n2", "approved", "nour");

    expect(h.rows.get("n2")).toEqual(expect.objectContaining({ approval: "approved", executedAt: null }));
  });

  // Second reader, 2026-10-30: both executor paths skip with NICK_AUTONOMY off, and the cron backstop
  // reads only 2 days, while the app lists rows up to 7 days old. Such an approve would never run.
  it("refuses while NICK_AUTONOMY is off: row stays pending, nothing sent", async () => {
    seed("n4", "nick_action_nudge_task", "nudge_task");
    h.flag.isOn = false;
    await expect(decidePendingAction("n4", "approved", "nour")).rejects.toThrow(/autonomy is off/);
    expect(h.rows.get("n4")?.approval).toBe("pending");
    expect(h.send).not.toHaveBeenCalled();
  });

  it("refuses a Nick action older than the executor's 2-day window", async () => {
    seed("n5", "nick_action_nudge_task", "nudge_task", new Date(Date.now() - NICK_ACTION_RUN_WINDOW_MS - 60_000));
    await expect(decidePendingAction("n5", "approved", "nour")).rejects.toThrow(/older than 2 days/);
    expect(h.rows.get("n5")?.approval).toBe("pending");
    expect(h.send).not.toHaveBeenCalled();
  });

  // 3404 follow-up (b): the 09:00Z backstop reads only rows under 2 days old, so a 1.9-day row whose
  // event failed would never run. The approval runs it in place instead, through the same batch core.
  it("when the event cannot be sent, the approved row runs in place through the batch core", async () => {
    vi.doMock("@/lib/ai/nick-action-batch", () => ({ runNickActionBatch: h.runBatch }));
    seed("n6", "nick_action_nudge_task", "nudge_task", new Date(Date.now() - NICK_ACTION_RUN_WINDOW_MS + 60 * 60_000));
    h.send.mockRejectedValueOnce(new Error("inngest down"));
    await decidePendingAction("n6", "approved", "nour");
    vi.doUnmock("@/lib/ai/nick-action-batch");
    expect(h.runBatch).toHaveBeenCalledWith(expect.objectContaining({ ids: ["n6"] }));
  });

  // 3404 follow-up (c): with the nick-action-approved runner switched off, the event is dropped
  // (KILLABLE_EVENT_FUNCTIONS), so Approve would say ok while nothing runs. Refuse with the reason.
  it("refuses while the nick-action-approved runner is switched off: row stays pending, nothing sent", async () => {
    seed("n7", "nick_action_nudge_task", "nudge_task");
    h.killed.mockImplementation(async (job: string) => job === "nick-action-approved");
    await expect(decidePendingAction("n7", "approved", "nour")).rejects.toThrow(/switched off/);
    expect(h.rows.get("n7")?.approval).toBe("pending");
    expect(h.send).not.toHaveBeenCalled();
  });

  // Second reader on #3437 (P2): an inline run that throws BEFORE its swap left the row approved and
  // unexecuted behind a 200, so an old row died silently past the 2-day window.
  it("an inline run that throws before claiming puts the row back in the queue and says so", async () => {
    vi.doMock("@/lib/ai/nick-action-batch", () => ({ runNickActionBatch: vi.fn(async () => { throw new Error("db read failed"); }) }));
    seed("n8", "nick_action_nudge_task", "nudge_task");
    h.send.mockRejectedValueOnce(new Error("inngest down"));
    await expect(decidePendingAction("n8", "approved", "nour")).rejects.toThrow(/back in the queue/);
    vi.doUnmock("@/lib/ai/nick-action-batch");
    expect(h.rows.get("n8")).toEqual(expect.objectContaining({ approval: "pending", executedAt: null }));
  });

  it("an inline run that throws after claiming leaves the claimed row alone (it ran or is running)", async () => {
    vi.doMock("@/lib/ai/nick-action-batch", () => ({
      runNickActionBatch: vi.fn(async () => {
        h.rows.get("n9")!.executedAt = new Date();
        throw new Error("digest failed");
      }),
    }));
    seed("n9", "nick_action_nudge_task", "nudge_task");
    h.send.mockRejectedValueOnce(new Error("inngest down"));
    await decidePendingAction("n9", "approved", "nour");
    vi.doUnmock("@/lib/ai/nick-action-batch");
    expect(h.rows.get("n9")?.approval).toBe("approved");
    expect(h.rows.get("n9")?.executedAt).not.toBeNull();
  });

  it("after a successful inline run the answer is the row as the run left it", async () => {
    vi.doMock("@/lib/ai/nick-action-batch", () => ({
      runNickActionBatch: vi.fn(async () => {
        h.rows.get("n10")!.executedAt = new Date();
        return { executed: 1, failed: 0, skipped: 0, results: [], telegramOk: true, total: 1 };
      }),
    }));
    seed("n10", "nick_action_nudge_task", "nudge_task");
    h.send.mockRejectedValueOnce(new Error("inngest down"));
    const out = await decidePendingAction("n10", "approved", "nour");
    vi.doUnmock("@/lib/ai/nick-action-batch");
    expect(out.executedAt).not.toBeNull();
  });

  it("CONTROL: rejecting a Nick action sends nothing", async () => {
    seed("n3", "nick_action_outreach_top_pick", "send_sms_outreach");
    await decidePendingAction("n3", "rejected", "nour");

    expect(h.send).not.toHaveBeenCalled();
    expect(h.rows.get("n3")?.approval).toBe("rejected");
  });

  it("CONTROL: an autonomous-engine rule still runs through executeApprovedAction", async () => {
    seed("r1", "auto_followup_expired_quote", "send_email");
    await decidePendingAction("r1", "approved", "nour");

    expect(h.executeApprovedAction).toHaveBeenCalledWith("r1");
    expect(h.send).not.toHaveBeenCalled();
  });
});

/**
 * CANARY: every kind of row the Approve button can be pressed on resolves to an executor.
 * The Nick Action Queue's proposals are read from the proposer's source (the only writer of
 * nick_action_* rows), so a new proposal kind with no executor fails here, not in prod.
 */
describe("every Nick action the proposer can create has an executor", () => {
  it("each proposed ruleName routes by its nick_action_ prefix to an actionType the batch core runs", async () => {
    vi.doMock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn() }));
    vi.doMock("@/lib/ai/execute-actions", () => ({ executeNickAction: vi.fn() }));
    const { NICK_ACTION_TYPES, TWO_DAYS_MS } = await import("@/lib/ai/nick-action-batch");
    expect(NICK_ACTION_RUN_WINDOW_MS).toBe(TWO_DAYS_MS);
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../lib/ai/propose-actions.ts", import.meta.url), "utf8");
    const pairs = [...src.matchAll(/ruleName:\s*"([^"]+)"[\s\S]{0,200}?actionType:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]);

    // The scan located its subject: today's four proposal kinds, by name.
    expect(pairs.map(([rule]) => rule).sort()).toEqual([
      "nick_action_commit_journal",
      "nick_action_nudge_task",
      "nick_action_outreach_top_pick",
      "nick_action_reassign_inbox",
    ]);
    for (const [rule, type] of pairs) {
      expect(rule.startsWith("nick_action_")).toBe(true);
      expect(NICK_ACTION_TYPES.has(type)).toBe(true);
    }
  });
});
