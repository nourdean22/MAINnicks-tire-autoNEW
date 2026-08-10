/**
 * Bounded bridge send action (Autopilot Wave 2, 2026-07-29).
 *
 * The ONE customer-texting action statenour may call. Pinned here:
 *   1. Auth: wrong/missing x-sync-key → 401, nothing runs.
 *   2. Input guards: uuid, body, idempotencyKey shape, approvedBy — all
 *      required; failures return errors and send NOTHING.
 *   3. Idempotency: a key already in audit_log → duplicate:true, zero sends.
 *   4. Happy path: sendOpportunityDraft is called with statenour attribution
 *      and the send is recorded with the idempotency marker.
 *   5. draft_opportunity_sms masks the phone (last-4 only).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendSpy = vi.fn(async () => ({ ok: true as const, queued: false }));
vi.mock("./services/opportunityDraft", () => ({
  sendOpportunityDraft: (...args: unknown[]) => sendSpy(...args),
  draftOpportunityOutreach: async () => ({
    ok: true,
    bestChannel: "sms",
    draft: "Hey, it's Nick's Tire & Auto…",
    riskLabel: "low",
    riskReasons: [],
    guardFindings: [],
  }),
}));

const auditSpy = vi.fn(async () => undefined);
vi.mock("./services/auditTrail", () => ({
  logAdminAction: (...args: unknown[]) => auditSpy(...args),
}));

const OPP_ID = "11111111-2222-4333-8444-555555555555";
vi.mock("./services/opportunityQueue", () => ({
  listOpportunities: async () => [{
    id: OPP_ID,
    sourceType: "stale_lead",
    customerName: "Sam",
    customerPhone: "+12165550101",
    state: "new",
    consentOk: true,
    recommendedAction: "Call Sam",
  }],
  topDecisions: async () => ({ decisions: [], totalLive: 0, excludedNoConsent: 0, excludedSnoozed: 0 }),
}));

let auditRows: Array<Record<string, unknown>> = [];
vi.mock("./db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      const text = JSON.stringify(q);
      if (text.includes("audit_log")) return [auditRows];
      return [[]];
    },
  }),
}));

type Handler = (req: unknown, res: unknown) => Promise<unknown>;
let routeHandler: Handler | null = null;

function fakeRes() {
  const res: { statusCode: number; body: unknown; status: (c: number) => typeof res; json: (b: unknown) => typeof res } = {
    statusCode: 200,
    body: null,
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; },
  };
  return res;
}

async function call(query: string, filters: Record<string, unknown>, key = "test-sync-key") {
  const { registerNourOsQueryRoute } = await import("./routes/nour-os-query");
  routeHandler = null;
  registerNourOsQueryRoute({
    post: (_path: string, fn: Handler) => { routeHandler = fn; },
  } as never);
  const res = fakeRes();
  await routeHandler!({ headers: { "x-sync-key": key }, body: { query, filters } }, res);
  return res;
}

const ORIG_KEY = process.env.STATENOUR_SYNC_KEY;

beforeEach(() => {
  vi.resetModules();
  process.env.STATENOUR_SYNC_KEY = "test-sync-key";
  sendSpy.mockClear();
  auditSpy.mockClear();
  auditRows = [];
});

afterEach(() => {
  if (ORIG_KEY === undefined) delete process.env.STATENOUR_SYNC_KEY;
  else process.env.STATENOUR_SYNC_KEY = ORIG_KEY;
});

const GOOD = {
  opportunityId: OPP_ID,
  body: "Hey Sam, it's Nick's Tire & Auto — still want a hand?",
  idempotencyKey: "chat-turn-abc123",
  approvedBy: "nour",
};

describe("auth", () => {
  it("wrong sync key → 401, no send", async () => {
    const res = await call("send_opportunity_sms", GOOD, "wrong-key");
    expect(res.statusCode).toBe(401);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe("send_opportunity_sms guards", () => {
  for (const [field, bad] of [
    ["opportunityId", "not-a-uuid"],
    ["body", ""],
    ["idempotencyKey", "x"],
    ["approvedBy", ""],
  ] as const) {
    it(`rejects bad ${field} without sending`, async () => {
      const res = await call("send_opportunity_sms", { ...GOOD, [field]: bad });
      expect(res.statusCode).toBe(200);
      expect((res.body as { data: { error?: string } }).data.error).toBeTruthy();
      expect(sendSpy).not.toHaveBeenCalled();
    });
  }

  it("duplicate idempotency key → duplicate:true, ZERO sends", async () => {
    auditRows = [{ 1: 1 }];
    const res = await call("send_opportunity_sms", GOOD);
    const data = (res.body as { data: Record<string, unknown> }).data;
    expect(data.duplicate).toBe(true);
    expect(data.sent).toBe(false);
    expect(data.deliveryState).toBe("duplicate");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  // 2026-08-10 · ACCEPTED IS NOT DISPATCHED. sendOpportunityDraft returns
  // queued:true when the message is held for the legal sending window. `sent`
  // used to be `result.ok`, so a queued message reported sent:true to any
  // caller reading that field. These two pin the vocabulary in BOTH directions
  // — a refactor that re-collapses them fails here, not in production.
  it("queued for the send window → sent:false, deliveryState 'queued'", async () => {
    sendSpy.mockResolvedValueOnce({ ok: true as const, queued: true });
    const res = await call("send_opportunity_sms", GOOD);
    const data = (res.body as { data: Record<string, unknown> }).data;
    expect(data.ok).toBe(true);
    expect(data.queued).toBe(true);
    expect(data.sent).toBe(false);
    expect(data.deliveryState).toBe("queued");
    expect(sendSpy).toHaveBeenCalled();
  });

  it("happy path: sends with statenour attribution and records the idempotency marker", async () => {
    const res = await call("send_opportunity_sms", GOOD);
    const data = (res.body as { data: Record<string, unknown> }).data;
    expect(data.sent).toBe(true);
    expect(data.deliveryState).toBe("dispatched");
    expect(data.duplicate).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: OPP_ID, by: "statenour:nour" }),
    );
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sms.bridge_send",
        details: expect.stringContaining("bridge_send:chat-turn-abc123"),
      }),
    );
  });
});

describe("draft_opportunity_sms", () => {
  it("returns the draft with a MASKED phone (last-4 only)", async () => {
    const res = await call("draft_opportunity_sms", { opportunityId: OPP_ID });
    const data = (res.body as { data: Record<string, unknown> }).data;
    expect(data.draft).toBeTruthy();
    expect(data.customerPhoneMasked).toBe("***-0101");
    expect(JSON.stringify(data)).not.toContain("2165550101");
  });
});
