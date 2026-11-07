/**
 * No silent close (audit 2026-11-07): at least 12 real requests were closed "no reply
 * needed" with nothing typed. Closing an obligation with no human reply now needs a typed
 * reason when any open text is longer than 25 characters and not spam. The reason is
 * optional in the input (the shipped client sends none) and enforced on the server.
 * Both close paths are covered: smsConversations.markNoReplyNeeded and the review
 * queue's actionHumanReview "resolve".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const h = vi.hoisted(() => ({
  open: [] as Array<{ id: number; body: string }>,
  executed: [] as Array<{ text: string; params: unknown[] }>,
  row: null as Record<string, unknown> | null,
  updates: [] as Array<Record<string, unknown>>,
}));

/** Render a drizzle `sql` template: text with `?` and the bound values. */
function render(q: unknown): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const walk = (node: unknown): string => {
    if (node && typeof node === "object" && Array.isArray((node as { queryChunks?: unknown[] }).queryChunks)) {
      return (node as { queryChunks: unknown[] }).queryChunks.map(walk).join("");
    }
    if (node && typeof node === "object" && Array.isArray((node as { value?: unknown }).value)) {
      return (node as { value: string[] }).value.join("");
    }
    params.push(node);
    return "?";
  };
  return { text: walk(q).replace(/\s+/g, " ").trim(), params };
}

vi.mock("../sms", () => ({ sendSms: vi.fn(async () => ({ success: true })) }));
vi.mock("../services/auditTrail", () => ({ logAdminAction: vi.fn(async () => undefined) }));

vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db")>();
  return {
    ...actual,
    getDbTyped: async () => ({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => (h.row ? [h.row] : []),
            orderBy: () => ({ limit: async () => [] }),
          }),
        }),
      }),
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: async () => {
            h.updates.push(set);
            return [{ affectedRows: 1 }, []];
          },
        }),
      }),
    }),
    getDb: async () => ({
      execute: async (q: unknown) => {
        const r = render(q);
        if (/FROM users/.test(r.text)) return [[{ adminRole: "owner", mfaEnabled: 0 }], []];
        h.executed.push(r);
        if (/^SELECT id, body FROM sms_response_jobs/.test(r.text)) return [h.open, []];
        return [{ affectedRows: h.open.length }, []];
      },
    }),
  };
});

import { appRouter } from "../routers";

function adminCtx(): TrpcContext {
  return {
    user: {
      id: 1, openId: "admin-openid", name: "Admin", email: "admin@nickstire.com", loginMethod: "manus", role: "admin",
      loyaltyPoints: 0, loyaltyTier: "bronze", totalVisits: 0, totalSpent: 0,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as any,
    res: {} as any,
  } as TrpcContext;
}
const conversations = () => appRouter.createCaller(adminCtx()).smsConversations;
const orchestrator = () => appRouter.createCaller(adminCtx()).smsOrchestrator;
const jobsClose = () => h.executed.find((q) => /^UPDATE sms_response_jobs/.test(q.text));

const REAL = "can i bring my car in today around noon?"; // 40 chars, a real ask
const SPAM = "You have been blocked from originating messages to this number";

beforeEach(() => {
  h.open = [];
  h.executed.length = 0;
  h.row = null;
  h.updates.length = 0;
});

describe("markNoReplyNeeded — a real request needs a typed reason", () => {
  it("refuses with no reason when an open text is a long real request, and closes nothing", async () => {
    h.open = [{ id: 11, body: REAL }];
    await expect(conversations().markNoReplyNeeded({ conversationId: 501 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/type why no reply is needed/i),
    });
    expect(jobsClose()).toBeUndefined();
  });

  it("closes with a typed reason and stores it on the closed rows, CAS on the ids it checked", async () => {
    h.open = [{ id: 11, body: REAL }];
    await expect(conversations().markNoReplyNeeded({ conversationId: 501, reason: "called them back" })).resolves.toEqual({ closed: 1 });
    const close = jobsClose()!;
    expect(close.text).toMatch(/status = \?/);
    expect(close.text).toMatch(/lastError = \?/);
    expect(close.text).toMatch(/AND id IN \(\?\)/);
    expect(close.params).toEqual(expect.arrayContaining(["no_reply_required", "no_reply_reason: called them back", 501, 11]));
  });

  it("a short text (25 chars or fewer) closes with no reason", async () => {
    h.open = [{ id: 12, body: "thanks see you soon" }];
    await expect(conversations().markNoReplyNeeded({ conversationId: 501 })).resolves.toEqual({ closed: 1 });
    expect(jobsClose()!.text).not.toMatch(/lastError/);
  });

  it("the threshold is > 25 characters: 25 closes, 26 is refused", async () => {
    h.open = [{ id: 13, body: "a".repeat(25) }];
    await expect(conversations().markNoReplyNeeded({ conversationId: 501 })).resolves.toEqual({ closed: 1 });
    h.open = [{ id: 14, body: "a".repeat(26) }];
    h.executed.length = 0;
    await expect(conversations().markNoReplyNeeded({ conversationId: 501 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a long spam text closes with no reason", async () => {
    h.open = [{ id: 15, body: SPAM }];
    await expect(conversations().markNoReplyNeeded({ conversationId: 501 })).resolves.toEqual({ closed: 1 });
  });

  it("one real text among spam still needs the reason", async () => {
    h.open = [{ id: 15, body: SPAM }, { id: 16, body: REAL }];
    await expect(conversations().markNoReplyNeeded({ conversationId: 501 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a whitespace-only reason does not count", async () => {
    h.open = [{ id: 11, body: REAL }];
    await expect(conversations().markNoReplyNeeded({ conversationId: 501, reason: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(jobsClose()).toBeUndefined();
  });
});

describe("actionHumanReview resolve — same rule on the review queue", () => {
  const draft = (over: Record<string, unknown> = {}) => ({
    id: 77, status: "drafted", statusReason: "human_takeover_active", customerPhone: "+12165550123",
    messageBody: "We can fit you in today.", providerUsed: "shop", variantKey: "nickgpt_v1",
    relatedConversationId: 501, createdAt: new Date(Date.now() - 60_000), isStale: 0, ...over,
  });

  it("refuses resolve with no reason on a long real request, and leaves the draft untouched", async () => {
    h.row = draft();
    h.open = [{ id: 21, body: REAL }];
    await expect(orchestrator().actionHumanReview({ id: 77, action: "resolve" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/type why no reply is needed/i),
    });
    expect(h.updates).toHaveLength(0);
    expect(jobsClose()).toBeUndefined();
  });

  it("resolves with a reason: the draft records it and the obligation closes with it", async () => {
    h.row = draft();
    h.open = [{ id: 21, body: REAL }];
    await expect(orchestrator().actionHumanReview({ id: 77, action: "resolve", reason: "customer came in" })).resolves.toEqual({ success: true });
    expect(h.updates[0]).toMatchObject({ status: "skipped", statusReason: "resolved_by_operator", noSendReason: "customer came in" });
    expect(jobsClose()!.params).toEqual(expect.arrayContaining(["no_reply_required", "no_reply_reason: customer came in", 21]));
  });

  it("a short text resolves with no reason, as before", async () => {
    h.row = draft();
    h.open = [{ id: 22, body: "ok thanks" }];
    await expect(orchestrator().actionHumanReview({ id: 77, action: "resolve" })).resolves.toEqual({ success: true });
    expect(h.updates[0]).toMatchObject({ status: "skipped", statusReason: "resolved_by_operator" });
  });
});
