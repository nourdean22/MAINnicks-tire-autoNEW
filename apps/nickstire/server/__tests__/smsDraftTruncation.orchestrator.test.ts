/**
 * F4a · the auto-send caller must hold a draft the provider cut off.
 *
 * DEFAULT_MAX_TOKENS is ~one SMS, so a draft that hit the cap stops mid-sentence
 * and — before this fix — looked exactly like a finished one. draftSmsReply now
 * reports `completion`; orchestrateSms may auto-send ONLY a "complete" draft.
 * "truncated" and "unknown" (no stop signal) are held for the operator, never sent.
 *
 * Positive control: the same inbound with completion "complete" still auto-sends,
 * so a hold here is the completion gate firing, not the harness never sending.
 * The DB/sms/flag harness is copied from smsOrchestrator.golden.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks for third-party integrations
const mockSendSms = vi.fn().mockResolvedValue({ success: true, sid: "SM_test_123" });
const mockMarkPhoneFullyOptedOut = vi.fn().mockResolvedValue(true);
const mockMarkPhoneOptedOut = vi.fn();
const mockMarkPhoneOptedIn = vi.fn();
const mockLoadSuppressionIndex = vi.fn().mockResolvedValue({ ok: true, phones: new Set<string>() });
vi.mock("../sms", () => ({
  sendSms: (...args: any[]) => mockSendSms(...args),
  withOptOut: (body: string) => body,
  markPhoneFullyOptedOut: (...args: any[]) => mockMarkPhoneFullyOptedOut(...args),
  markPhoneOptedOut: (...args: any[]) => mockMarkPhoneOptedOut(...args),
  markPhoneOptedIn: (...args: any[]) => mockMarkPhoneOptedIn(...args),
  loadSuppressionIndex: (...args: any[]) => mockLoadSuppressionIndex(...args),
}));

const mockLogSmsOptOut = vi.fn().mockResolvedValue(undefined);
const mockLogSmsOptIn = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/complianceLog", () => ({
  logSmsOptOut: (...args: any[]) => mockLogSmsOptOut(...args),
  logSmsOptIn: (...args: any[]) => mockLogSmsOptIn(...args),
}));

const mockDraftSmsReply = vi.fn().mockResolvedValue({ ok: true, draft: "Hi! Used tires are $60 installed.", source: "fallback-claude", latencyMs: 100 });
vi.mock("../services/nickgpt-client", () => ({
  draftSmsReply: (...args: any[]) => mockDraftSmsReply(...args),
}));

const mockClassifyIntent = vi.fn().mockResolvedValue({ ok: true, topLabel: "greeting or hello", topScore: 0.95 });
vi.mock("../services/classifiers", () => ({
  classifyIntent: (...args: any[]) => mockClassifyIntent(...args),
}));

const mockIsEnabled = vi.fn().mockResolvedValue(true);
vi.mock("../services/featureFlags", () => ({
  isEnabled: (...args: any[]) => mockIsEnabled(...args),
}));

// Mock DB
const mockInsertId = { id: 42 };

let mockRolloutGlobalMode: string | undefined = undefined;
let mockRolloutEventMode: string | undefined = undefined;
let mockDbAvailable = true;
let mockResolvedValues: any[] = [];
let mockTableResponses: Record<string, any> = {};

function getTableName(table: any): string | null {
  if (!table) return null;
  const nameSymbol = Symbol.for('drizzle:Name');
  if (table[nameSymbol]) return table[nameSymbol];
  if (table._ && table._.name) return table._.name;
  if (table.dbName) return table.dbName;
  return null;
}

function createQueryBuilder(table?: any) {
  const qb = {
    _currentTable: table,
    _resolvedValue: undefined as any,
    from: vi.fn().mockImplementation((t) => {
      qb._currentTable = t;
      return qb;
    }),
    where: vi.fn().mockImplementation((...args) => {
      const res = mockDb.where(...args);
      if (res !== mockDb) {
        qb._resolvedValue = res;
      }
      return qb;
    }),
    orderBy: vi.fn().mockImplementation((...args) => {
      mockDb.orderBy(...args);
      return qb;
    }),
    limit: vi.fn().mockImplementation((val) => {
      const tableName = getTableName(qb._currentTable);
      if (tableName === "app_secret_kv") {
        mockDb._appSecretKvQueryCount++;
        if (mockDb._appSecretKvQueryCount === 1) {
          qb._resolvedValue = mockRolloutGlobalMode ? [{ v: mockRolloutGlobalMode }] : [];
        } else {
          qb._resolvedValue = mockRolloutEventMode ? [{ v: mockRolloutEventMode }] : [];
        }
        return qb;
      }
      const res = mockDb.limit(val);
      if (res !== mockDb) {
        qb._resolvedValue = res;
      }
      return qb;
    }),
    offset: vi.fn().mockImplementation((...args) => {
      mockDb.offset(...args);
      return qb;
    }),
    set: vi.fn().mockImplementation((...args) => {
      mockDb.set(...args);
      return qb;
    }),
    values: vi.fn().mockImplementation((...args) => {
      const res = mockDb.values(...args);
      if (res !== mockDb) {
        qb._resolvedValue = res;
      }
      return {
        $returningId: () => [mockInsertId]
      };
    }),
    then: (resolve: any) => {
      if (qb._resolvedValue !== undefined) {
        Promise.resolve(qb._resolvedValue).then(resolve);
      } else {
        const tableName = getTableName(qb._currentTable);
        if (tableName && mockTableResponses[tableName] !== undefined) {
          const val = typeof mockTableResponses[tableName] === 'function'
            ? mockTableResponses[tableName]()
            : mockTableResponses[tableName];
          resolve(val);
        } else if (mockResolvedValues.length > 0) {
          resolve(mockResolvedValues.shift());
        } else {
          resolve([]);
        }
      }
    }
  };
  return qb;
}

const mockDb = {
  _appSecretKvQueryCount: 0,
  select: vi.fn().mockImplementation(() => createQueryBuilder()),
  from: vi.fn().mockImplementation((table) => createQueryBuilder(table)),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  offset: vi.fn().mockReturnThis(),
  update: vi.fn().mockImplementation((table) => createQueryBuilder(table)),
  set: vi.fn().mockReturnThis(),
  insert: vi.fn().mockImplementation((table) => createQueryBuilder(table)),
  values: vi.fn().mockReturnThis(),
  execute: vi.fn().mockResolvedValue([[]]),
};

vi.mock("../db", () => ({
  getDbTyped: () => Promise.resolve(mockDbAvailable ? mockDb : null),
  getDb: () => Promise.resolve(mockDbAvailable ? mockDb : null),
}));

const mockNotifyOwner = vi.fn().mockResolvedValue(true);
vi.mock("../_core/notification", () => ({
  notifyOwner: (...args: any[]) => mockNotifyOwner(...args),
}));

import { orchestrateSms } from "../services/smsOrchestrator";

// A tire-size question: an intent the 2026-10-30 eval proved, so its finished
// draft may auto-send (W2 holds drafts for unproven intents).
const INBOUND = "do you have a 225/65R17 for my pickup";
const DRAFT_FINISHED = "Yes, we do alignments on trucks. Want to bring it by this week?";
const DRAFT_CUT = "Yes, we do alignments on trucks. We can usually get you in the same day if you";
// W2: a held draft still gets the holding reply; what must never go out is the DRAFT.
const HOLDING = "A staff member will get back to you shortly.";
const expectNoDraftSent = () => expect(mockSendSms.mock.calls.filter((c: any[]) => c[1] !== HOLDING)).toEqual([]);

describe("orchestrateSms · F4a truncated AI drafts never auto-send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Math, "random").mockReturnValue(0);
    mockDb._appSecretKvQueryCount = 0;
    mockRolloutGlobalMode = undefined;
    mockRolloutEventMode = undefined;
    mockDbAvailable = true;
    mockResolvedValues = [];
    mockTableResponses = {
      customers: [{ id: 1, firstName: "John", smsOptOut: 0 }],
      bookings: [], callback_requests: [], leads: [], alg_estimates: [],
      sms_conversations: [], sms_messages: [], sms_orchestrations: [],
      sms_orchestration_outcomes: [], sms_learning_recommendations: [],
      vapi_call_logs: [], app_secret_kv: [], invoices: [],
      nickgpt_drafts: [], nickgpt_training_examples: [],
    };
    mockDb.select.mockImplementation(() => createQueryBuilder());
    mockDb.from.mockImplementation((table) => createQueryBuilder(table));
    mockDb.update.mockImplementation((table) => createQueryBuilder(table));
    mockDb.insert.mockImplementation((table) => createQueryBuilder(table));
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockReturnThis();
    mockDb.offset.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockSendSms.mockResolvedValue({ success: true, sid: "SM_test_123" });
    mockClassifyIntent.mockResolvedValue({ ok: true, topLabel: "asking about tire prices or sizes", topScore: 0.95 });
    mockIsEnabled.mockResolvedValue(true);
    mockNotifyOwner.mockResolvedValue(true);
  });

  const draft = (text: string, completion?: string) => ({
    ok: true, draft: text, source: "fallback-claude", modelName: "m", latencyMs: 100,
    ...(completion === undefined ? {} : { completion }),
  });
  const inbound = () => orchestrateSms({ type: "inbound_sms", phone: "2165550077", body: INBOUND, conversationId: 777 });

  it("positive control: a provider-confirmed finished draft auto-sends", async () => {
    mockDraftSmsReply.mockResolvedValue(draft(DRAFT_FINISHED, "complete"));
    const res = await inbound();
    expect(mockDraftSmsReply).toHaveBeenCalledTimes(1);
    expect(res.shouldAutoSend).toBe(true);
    expect(mockSendSms).toHaveBeenCalledTimes(1);
  });

  it("a truncated draft is held for the operator, not sent", async () => {
    mockDraftSmsReply.mockResolvedValue(draft(DRAFT_CUT, "truncated"));
    const res = await inbound();
    expect(mockDraftSmsReply).toHaveBeenCalledTimes(1);
    expect(res.shouldAutoSend).toBe(false);
    expect(res.status).toBe("drafted");
    expect(res.reason).toBe("draft_truncated");
    expectNoDraftSent();
  });

  it("an unknown stop signal is held too — unknown is not finished", async () => {
    mockDraftSmsReply.mockResolvedValue(draft(DRAFT_FINISHED, "unknown"));
    const res = await inbound();
    expect(res.shouldAutoSend).toBe(false);
    expect(res.reason).toBe("draft_completion_unknown");
    expectNoDraftSent();
  });

  it("a truncated complaint is held and keeps its complaint reason", async () => {
    mockClassifyIntent.mockResolvedValue({ ok: true, topLabel: "complaint or negative feedback", topScore: 0.99 });
    mockDraftSmsReply.mockResolvedValue(draft(DRAFT_CUT, "truncated"));
    const res = await inbound();
    expect(res.shouldAutoSend).toBe(false);
    expect(res.reason).toBe("high_risk_complaint_detected");
    expectNoDraftSent();
  });

  // 2026-10-30 · a provider can say "stop" on a two-word stub (thinking ate the
  // budget). A finished-looking stub must still be held, never texted.
  it("a 'complete' draft that stops mid-sentence is held, not sent", async () => {
    mockDraftSmsReply.mockResolvedValue(draft("Yes, we do", "complete"));
    const res = await inbound();
    expect(res.shouldAutoSend).toBe(false);
    expect(res.reason).toBe("plan_violation:unfinished_draft");
    expectNoDraftSent();
  });

  it("a finished draft under 5 words is held, never auto-sent", async () => {
    mockDraftSmsReply.mockResolvedValue(draft("Sure, come by.", "complete"));
    const res = await inbound();
    expect(res.shouldAutoSend).toBe(false);
    expect(res.reason).toBe("draft_too_short");
    expectNoDraftSent();
  });

  it("records which provider and model wrote the draft on the orchestration row", async () => {
    mockDraftSmsReply.mockResolvedValue({ ...draft(DRAFT_FINISHED, "complete"), finishReason: "stop" });
    await inbound();
    // inbound rows are inserted early and finalised with update().set(payload)
    const rows = [...mockDb.values.mock.calls, ...mockDb.set.mock.calls]
      .map((c: any[]) => c[0]).filter((v: any) => v && typeof v.metadataJson === "string");
    const meta = rows.map((r: any) => JSON.parse(r.metadataJson)).find((m: any) => m.draft);
    expect(meta?.draft).toEqual({ source: "fallback-claude", model: "m", completion: "complete", finishReason: "stop" });
  });

  it("a result with no completion field at all (older contract) is held", async () => {
    mockDraftSmsReply.mockResolvedValue(draft(DRAFT_FINISHED));
    const res = await inbound();
    expect(res.shouldAutoSend).toBe(false);
    expectNoDraftSent();
  });
});

// W2 (2026-10-30) · non-customer texts stay silent, and a real customer whose
// draft is held for staff hears Nour's holding reply, once per thread per 24 h.
describe("orchestrateSms · W2 non-customer filter and holding reply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._appSecretKvQueryCount = 0;
    mockRolloutGlobalMode = undefined;
    mockRolloutEventMode = undefined;
    mockDbAvailable = true;
    mockDb.execute.mockResolvedValue([[]]);
    mockSendSms.mockResolvedValue({ success: true, sid: "SM_test_123" });
    mockClassifyIntent.mockResolvedValue({ ok: true, topLabel: "asking about tire prices or sizes", topScore: 0.95 });
    mockIsEnabled.mockResolvedValue(true);
  });
  const draft = (text: string, completion: string) => ({ ok: true, draft: text, source: "fallback-claude", modelName: "m", latencyMs: 100, completion });
  // Each call is a new thread unless one is passed: the holding-reply claim is per thread.
  let nextConversationId = 7000;
  const inbound = (body = INBOUND, conversationId = nextConversationId++) =>
    orchestrateSms({ type: "inbound_sms", phone: "2165550077", body, conversationId });

  it("a bulk marketing text gets no draft, no staff-queue item and no text", async () => {
    const res = await inbound("Automate HR with our AI payroll software. Reply YES for a demo, STOP to end");
    expect(mockDraftSmsReply).not.toHaveBeenCalled();
    expect(res.status).toBe("skipped");
    expect(res.requiresHumanApproval).toBe(false);
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("a held draft for a real customer sends the holding reply, and only that", async () => {
    mockDraftSmsReply.mockResolvedValue(draft(DRAFT_CUT, "truncated"));
    const res = await inbound();
    expect(res.status).toBe("drafted");
    expect(res.holdingReply).toBe(true);
    expect(mockSendSms).toHaveBeenCalledTimes(1);
    expect(mockSendSms.mock.calls[0][1]).toBe("A staff member will get back to you shortly.");
  });

  it("no second holding reply in the same thread within 24 hours", async () => {
    mockDraftSmsReply.mockResolvedValue(draft(DRAFT_CUT, "truncated"));
    mockDb.execute.mockResolvedValue([[{ n: 1 }]]);
    try {
      const res = await inbound();
      expect(res.holdingReply).toBe(false);
      expect(mockSendSms).not.toHaveBeenCalled();
    } finally {
      mockDb.execute.mockResolvedValue([[]]);
    }
  });

  it("positive control: an auto-sent answer gets no holding reply on top", async () => {
    mockDraftSmsReply.mockResolvedValue(draft(DRAFT_FINISHED, "complete"));
    const res = await inbound();
    expect(res.holdingReply).toBe(false);
    expect(mockSendSms).toHaveBeenCalledTimes(1);
    expect(mockSendSms.mock.calls[0][1]).not.toMatch(/staff member/i);
  });

  it("a draft for an intent the eval has not proven is held, even at high confidence, and the customer hears the holding reply", async () => {
    mockClassifyIntent.mockResolvedValue({ ok: true, topLabel: "greeting or hello", topScore: 0.99 });
    mockDraftSmsReply.mockResolvedValue(draft("Hey, this is Nick's Tire and Auto. What can we help you with today?", "complete"));
    const res = await inbound("Hello?");
    expect(res.shouldAutoSend).toBe(false);
    expect(res.reason).toBe("intent_not_proven:general");
    expect(res.holdingReply).toBe(true);
    expect(mockSendSms).toHaveBeenCalledTimes(1);
    expect(mockSendSms.mock.calls[0][1]).toBe("A staff member will get back to you shortly.");
  });

  it("a thank-you gets no draft, no staff-queue item and no text", async () => {
    const res = await inbound("thanks I got it fixed");
    expect(mockDraftSmsReply).not.toHaveBeenCalled();
    expect(res.status).toBe("skipped");
    expect(res.requiresHumanApproval).toBe(false);
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  // Codex review of #3393 (2026-10-30), one case per finding.
  it("two texts in one thread processed at once get one holding reply, not two", async () => {
    mockDraftSmsReply.mockResolvedValue(draft(DRAFT_CUT, "truncated"));
    await Promise.all([inbound(INBOUND, 9001), inbound(INBOUND, 9001)]);
    const holding = mockSendSms.mock.calls.filter((c) => c[1] === "A staff member will get back to you shortly.");
    expect(holding).toHaveLength(1);
  });

  it("draft_only rollout keeps a non-customer text skipped, out of the staff queue", async () => {
    mockRolloutEventMode = "draft_only";
    const res = await inbound("Automate HR with our AI payroll software. Reply YES for a demo, STOP to end");
    expect(res.status).toBe("skipped");
    expect(res.requiresHumanApproval).toBe(false);
  });

  it("a noise marker never hides a safety text: it reaches staff", async () => {
    const res = await inbound("here is the tracking number, but my brakes failed");
    expect(res.status).not.toBe("skipped");
    expect(res.requiresHumanApproval).toBe(true);
  });

  it("a proven primary with an unproven second question is held, not auto-sent", async () => {
    mockDraftSmsReply.mockResolvedValue(draft(DRAFT_FINISHED, "complete"));
    const res = await inbound("do you have 225/65R17 and can I pay monthly?");
    expect(res.shouldAutoSend).toBe(false);
    expect(res.reason).toMatch(/^intent_not_proven:/);
  });
});
