/**
 * Agent follow-ups: a replay never delivers twice (audit 08-X2, 2026-10-11).
 *
 * A worker that died after writing the message but before marking the outbox row
 * done left it `processing`; the stale reclaim then ran it again and wrote a second
 * message. runFollowUp now claims an ActionAttempt keyed by the outbox row before
 * generating, and the stale window is wider than one tick (it equalled the 15 min tick).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Attempt = { id: string; operationKey: string; state: string; attemptNo: number; holdUntil: Date | null };
const h = vi.hoisted(() => ({
  attempts: [] as Attempt[],
  attemptCreateFails: null as Error | null,
  aiChat: vi.fn(),
  msgCreate: vi.fn(),
  outboxRows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatConversation: { findUnique: async () => ({ id: "conv-1", archivedAt: null }) },
    chatMessage: { findMany: async () => [], create: (a: unknown) => h.msgCreate(a) },
    actionAttempt: {
      create: async ({ data }: { data: Omit<Attempt, "id"> }) => {
        if (h.attemptCreateFails) throw h.attemptCreateFails;
        if (h.attempts.some((a) => a.operationKey === data.operationKey)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        const row = { ...data, id: `att-${h.attempts.length + 1}` } as Attempt;
        h.attempts.push(row);
        return { id: row.id, attemptNo: row.attemptNo };
      },
      findUnique: async ({ where }: { where: { operationKey?: string; id?: string } }) =>
        h.attempts.find((a) => a.operationKey === where.operationKey || a.id === where.id) ?? null,
      // The reclaim compare-and-set: every field the decision read must still match.
      updateMany: async ({ where, data }: { where: Partial<Attempt>; data: Partial<Attempt> }) => {
        const row = h.attempts.find(
          (a) =>
            a.id === where.id &&
            a.attemptNo === where.attemptNo &&
            a.state === where.state &&
            (a.holdUntil?.getTime() ?? null) === (where.holdUntil?.getTime() ?? null),
        );
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Attempt> }) => {
        const row = h.attempts.find((a) => a.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    postTurnOutbox: {
      findMany: async ({ where }: { where: { OR: Array<Record<string, unknown>> } }) => {
        const now = Date.now();
        return h.outboxRows.filter((r) =>
          where.OR.some((c) =>
            c.status === "processing"
              ? r.status === "processing" && (r.updatedAt as Date).getTime() < (c.updatedAt as { lt: Date }).lt.getTime()
              : r.status === "pending" && (r.nextAttemptAt as Date).getTime() <= now,
          ),
        );
      },
      updateMany: async () => ({ count: 1 }),
      findUnique: async ({ where }: { where: { id: string } }) => h.outboxRows.find((r) => r.id === where.id) ?? null,
    },
  },
}));
vi.mock("@/lib/ai/provider", () => ({
  aiChat: (...a: unknown[]) => h.aiChat(...a),
  isAiSentinel: (r: { provider?: string }) => r.provider === "emergency" || r.provider === "none",
}));

import { runFollowUp } from "@/lib/agent/run-follow-up";
import { claimDueFollowUps } from "@/lib/agent/follow-up";

const PAYLOAD = { conversationId: "conv-1", instruction: "check supplier", reason: "asked", dedupeKey: "k", scheduledAt: "x" };

beforeEach(() => {
  h.attempts = [];
  h.attemptCreateFails = null;
  h.outboxRows = [];
  h.aiChat.mockReset().mockResolvedValue({ content: "Supplier has not replied yet.", provider: "ollama", model: "m" });
  h.msgCreate.mockReset().mockResolvedValue({ id: "msg-1" });
  process.env.NICK_AGENT_FOLLOWUPS = "1";
});

describe("runFollowUp: one delivery per outbox row", () => {
  it("a replay of the same outbox row generates and writes once", async () => {
    const first = await runFollowUp(PAYLOAD, { outboxId: "row-1" });
    const replay = await runFollowUp(PAYLOAD, { outboxId: "row-1" });
    expect(h.aiChat).toHaveBeenCalledTimes(1);
    expect(h.msgCreate).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ ok: true, reason: "delivered" });
    expect(replay).toMatchObject({ ok: true, reason: "already delivered" });
    expect(h.attempts[0]).toMatchObject({ operationKey: "agent-followup:row-1", state: "SUCCEEDED_UNVERIFIED" });
  });

  it("a replay while the first attempt is still in flight does not claim delivery or write", async () => {
    h.attempts.push({ id: "att-x", operationKey: "agent-followup:row-1", state: "EXECUTING", attemptNo: 1, holdUntil: new Date(Date.now() + 3_600_000) });
    const r = await runFollowUp(PAYLOAD, { outboxId: "row-1" });
    expect(h.aiChat).not.toHaveBeenCalled();
    expect(h.msgCreate).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(r.retryable).toBeFalsy();
  });

  it("an unreachable attempt store is retryable and generates nothing", async () => {
    h.attemptCreateFails = new Error("db down");
    const r = await runFollowUp(PAYLOAD, { outboxId: "row-1" });
    expect(h.aiChat).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, retryable: true });
  });

  it("a provider outage settles the attempt FAILED, so the retry can deliver", async () => {
    h.aiChat.mockResolvedValueOnce({ content: "", provider: "emergency", model: "none" });
    const first = await runFollowUp(PAYLOAD, { outboxId: "row-1" });
    expect(first).toMatchObject({ ok: false, retryable: true });
    expect(h.attempts[0].state).toBe("FAILED");
    const retry = await runFollowUp(PAYLOAD, { outboxId: "row-1" });
    expect(retry).toMatchObject({ ok: true, reason: "delivered" });
    expect(h.msgCreate).toHaveBeenCalledTimes(1);
  });
});

describe("runFollowUp: a throw before the write", () => {
  it("a failed message write settles the attempt FAILED and rethrows, so the retry can deliver", async () => {
    h.msgCreate.mockRejectedValueOnce(new Error("write failed"));
    await expect(runFollowUp(PAYLOAD, { outboxId: "row-1" })).rejects.toThrow("write failed");
    expect(h.attempts[0].state).toBe("FAILED");
    expect(await runFollowUp(PAYLOAD, { outboxId: "row-1" })).toMatchObject({ ok: true, reason: "delivered" });
  });
});

describe("claimDueFollowUps: the stale window outlives one tick", () => {
  it("a processing row 16 min old is NOT reclaimed (its worker may still be running)", async () => {
    h.outboxRows.push({ id: "row-1", kind: "agent-followup", status: "processing", attempts: 1, updatedAt: new Date(Date.now() - 16 * 60_000), payload: PAYLOAD });
    expect(await claimDueFollowUps(5)).toHaveLength(0);
  });

  it("CONTROL: a processing row 40 min old is reclaimed", async () => {
    h.outboxRows.push({ id: "row-1", kind: "agent-followup", status: "processing", attempts: 1, updatedAt: new Date(Date.now() - 40 * 60_000), payload: PAYLOAD });
    expect(await claimDueFollowUps(5)).toHaveLength(1);
  });
});
