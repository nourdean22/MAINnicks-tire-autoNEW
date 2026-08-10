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
/** Captured SQL of the last audit_log query — lets a test assert the SHAPE of
 *  the idempotency guard, not just its mocked result. See the schema-conformance
 *  test below for why that matters. */
let lastAuditSql = "";
/** Simulates the real failure this file now guards: the DB rejecting the
 *  idempotency query (e.g. MySQL 1054, unknown column). */
let auditThrows = false;
vi.mock("./db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      const text = JSON.stringify(q);
      if (text.includes("audit_log")) {
        lastAuditSql = text;
        if (auditThrows) throw new Error("Unknown column 'details' in 'where clause'");
        return [auditRows];
      }
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
  lastAuditSql = "";
  auditThrows = false;
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

  // 2026-08-10 · THE GUARD ABOVE HAD NEVER RUN IN PRODUCTION. It queried
  // `audit_log.details`; that column does not exist (audit_log was created in
  // drizzle/0016_past_stone_men.sql with 8 columns and never ALTERed), so every
  // call raised MySQL 1054 and this lane never sent a single message. The old
  // tests could not catch it — they mock `execute` and hand rows back, so the
  // column name was never exercised. These two pin the SHAPE, not the result.
  it("the idempotency guard only references columns that exist on audit_log", async () => {
    const { getTableColumns } = await import("drizzle-orm");
    const { auditLog } = await import("../drizzle/schema");
    const realColumns = Object.values(getTableColumns(auditLog)).map((c) => (c as { name: string }).name);

    // The premise. If someone later ADDS a details column, this fails and tells
    // them to come back and reconsider the JSON extraction below.
    expect(realColumns).not.toContain("details");
    expect(realColumns).toContain("changes");

    await call("send_opportunity_sms", GOOD);
    expect(lastAuditSql).toContain("audit_log");
    expect(lastAuditSql).not.toMatch(/\bdetails\b/);
    expect(lastAuditSql).toContain("changes");
  });

  it("idempotency query failure → refuses to send, and names the gate", async () => {
    auditThrows = true;
    const res = await call("send_opportunity_sms", GOOD);
    const data = (res.body as { data: { error?: string } }).data;
    expect(data.error).toMatch(/idempotency check failed/i);
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
    // PIN THE PRODUCER. logAdminAction only lands `details` in the `changes`
    // JSON — at `$.detail.new`, the path the guard queries — when NONE of
    // previousValue/newValue/metadata are supplied; otherwise its ternary
    // (services/auditTrail.ts:93) silently drops the detail string and the
    // idempotency marker never gets written. Keep this call detail-only.
    const auditArg = auditSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(auditArg.metadata).toBeUndefined();
    expect(auditArg.previousValue).toBeUndefined();
    expect(auditArg.newValue).toBeUndefined();
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
