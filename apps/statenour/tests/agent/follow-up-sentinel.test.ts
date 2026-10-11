/**
 * Audit 2026-10-10 08-F5: runFollowUp refused to persist the aiChat outage
 * sentinel (good) but the cron then marked the row `done`, so a follow-up
 * that hit a provider outage was dropped forever. A sentinel is a transient
 * failure: the row goes back to `pending` with a backoff, never `done`.
 * The claim (claimDueFollowUps) already increments `attempts`, so the
 * attempt is counted once and the existing < 3 cap still dead-letters it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/utils/http", () => ({
  cronHandler: (fn: (req: Request, ctx: unknown) => Promise<unknown>) => fn,
}));

const mockAiChat = vi.fn();
vi.mock("@/lib/ai/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/provider")>()),
  aiChat: (...a: unknown[]) => mockAiChat(...a),
}));

const db = vi.hoisted(() => ({
  outboxUpdate: vi.fn(),
  convFindUnique: vi.fn(),
  msgFindMany: vi.fn(),
  msgCreate: vi.fn(),
  claim: vi.fn(),
  attempts: [] as Array<{ id: string; operationKey: string; state: string; attemptNo: number; holdUntil: Date | null }>,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    postTurnOutbox: { update: db.outboxUpdate },
    chatConversation: { findUnique: db.convFindUnique },
    // findFirst: the delivery-receipt lookup (no prior follow-up message in these cases).
    chatMessage: { findMany: db.msgFindMany, create: db.msgCreate, findFirst: async () => null },
    aiGeneration: { groupBy: vi.fn().mockResolvedValue([]) },
    // runFollowUp's per-outbox-row delivery claim (beginAttempt / settleAttempt), kept in memory.
    actionAttempt: {
      create: async ({ data }: { data: { operationKey: string; state: string; attemptNo: number; holdUntil: Date | null } }) => {
        if (db.attempts.some((a) => a.operationKey === data.operationKey)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        const row = { ...data, id: `att-${db.attempts.length + 1}` };
        db.attempts.push(row);
        return { id: row.id, attemptNo: row.attemptNo };
      },
      findUnique: async ({ where }: { where: { id?: string; operationKey?: string } }) =>
        db.attempts.find((a) => a.id === where.id || a.operationKey === where.operationKey) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
        Object.assign(db.attempts.find((a) => a.id === where.id)!, data),
    },
  },
}));
vi.mock("@/lib/agent/follow-up", () => ({
  areFollowUpsEnabled: () => true,
  claimDueFollowUps: (...a: unknown[]) => db.claim(...a),
}));
vi.mock("@/lib/services/cron-control", () => ({ isCronEnabled: vi.fn().mockResolvedValue(true) }));

import { GET } from "@/app/api/cron/agent-followups/route";

const SENTINEL = {
  content: "I'm having trouble connecting to my AI providers right now. try again in a moment.",
  provider: "emergency",
  model: "none",
};
const PAYLOAD = { conversationId: "conv-1", instruction: "check supplier", reason: "asked", dedupeKey: "k" };
const NOW = new Date("2026-10-10T14:15:00Z");

const run = () => (GET as unknown as (req: Request, ctx: unknown) => Promise<Record<string, unknown>>)(
  new Request("http://localhost/api/cron/agent-followups"),
  {},
);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mockAiChat.mockReset();
  db.outboxUpdate.mockReset().mockResolvedValue({});
  db.convFindUnique.mockReset().mockResolvedValue({ id: "conv-1", archivedAt: null });
  db.msgFindMany.mockReset().mockResolvedValue([]);
  db.msgCreate.mockReset().mockResolvedValue({ id: "msg-1" });
  db.claim.mockReset();
  db.attempts = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("agent-followups cron - provider sentinel", () => {
  it("puts the row back to pending with a 5*attempts minute backoff, never done", async () => {
    // attempts=2 is the value AFTER the claim's increment
    db.claim.mockResolvedValue([{ id: "row-1", payload: PAYLOAD, attempts: 2 }]);
    mockAiChat.mockResolvedValue(SENTINEL);
    await run();
    expect(db.msgCreate).not.toHaveBeenCalled();
    expect(db.outboxUpdate).toHaveBeenCalledTimes(1);
    const { data } = db.outboxUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.status).toBe("pending");
    expect(data.nextAttemptAt).toEqual(new Date(NOW.getTime() + 10 * 60_000));
    expect(String(data.lastError)).toContain("provider");
    // the claim already counted this attempt; no second increment
    expect(data.attempts).toBeUndefined();
  });

  it("dead-letters at the attempt cap instead of retrying forever", async () => {
    db.claim.mockResolvedValue([{ id: "row-1", payload: PAYLOAD, attempts: 3 }]);
    mockAiChat.mockResolvedValue(SENTINEL);
    await run();
    const { data } = db.outboxUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.status).toBe("failed");
  });

  it("control: a real reply is delivered and the row is done", async () => {
    db.claim.mockResolvedValue([{ id: "row-1", payload: PAYLOAD, attempts: 1 }]);
    mockAiChat.mockResolvedValue({ content: "Supplier has not replied yet.", provider: "ollama", model: "m" });
    const res = await run();
    expect(res.delivered).toBe(1);
    const { data } = db.outboxUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.status).toBe("done");
  });

  it("control: an archived thread is a legitimate drop (done)", async () => {
    db.claim.mockResolvedValue([{ id: "row-1", payload: PAYLOAD, attempts: 1 }]);
    db.convFindUnique.mockResolvedValue({ id: "conv-1", archivedAt: new Date() });
    await run();
    const { data } = db.outboxUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.status).toBe("done");
  });
});
