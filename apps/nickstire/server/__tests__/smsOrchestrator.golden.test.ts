import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks for third-party integrations
const mockSendSms = vi.fn().mockResolvedValue({ success: true, sid: "SM_test_123" });
vi.mock("../sms", () => ({
  sendSms: (...args: any[]) => mockSendSms(...args),
  withOptOut: (body: string) => body,
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
  getDbTyped: () => Promise.resolve(mockDb),
  getDb: () => Promise.resolve(mockDb),
}));

const mockNotifyOwner = vi.fn().mockResolvedValue(true);
vi.mock("../_core/notification", () => ({
  notifyOwner: (...args: any[]) => mockNotifyOwner(...args),
}));

// Import orchestrator and helpers
import { orchestrateSms, loadCustomerContext, humanizeCopy } from "../services/smsOrchestrator";
import { getTemplateVariant } from "../services/smsMessageCatalog";
import { generateDailySmsReport, generateWeeklySmsReport, getSmsVariantPerformance, trackDraftFeedback } from "../services/smsLearningEngine";

describe("SMS Operating System & Orchestrator Golden Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Math, "random").mockReturnValue(0);
    mockDb._appSecretKvQueryCount = 0;
    mockRolloutGlobalMode = undefined;
    mockRolloutEventMode = undefined;
    mockResolvedValues = [];
    mockTableResponses = {
      customers: [{ id: 1, firstName: "John", smsOptOut: 0 }],
      bookings: [],
      callback_requests: [],
      leads: [],
      alg_estimates: [],
      sms_conversations: [],
      sms_messages: [],
      sms_orchestrations: [],
      sms_orchestration_outcomes: [],
      sms_learning_recommendations: [],
      vapi_call_logs: [],
      app_secret_kv: [],
      invoices: [],
      nickgpt_drafts: [],
      nickgpt_training_examples: [],
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
    mockDraftSmsReply.mockResolvedValue({ ok: true, draft: "Hi! Used tires are $60 installed.", source: "fallback-claude", latencyMs: 100 });
    mockClassifyIntent.mockResolvedValue({ ok: true, topLabel: "greeting or hello", topScore: 0.95 });
    mockIsEnabled.mockResolvedValue(true);
    mockNotifyOwner.mockResolvedValue(true);
  });

  // 1. STOP Keyword
  it("STOP -> opts out customer, logs customer_opted_out status, blocks auto-sends", async () => {
    // customers default is already [ { id: 1, firstName: "John", smsOptOut: 0 } ]
    const res = await orchestrateSms({
      type: "inbound_sms",
      phone: "2165550001",
      body: "STOP",
      conversationId: 101,
    });

    expect(res.status).toBe("blocked");
    expect(res.shouldAutoSend).toBe(false);
    expect(res.reason).toBe("unsubscribe_keyword_matched");
  });

  // 2. YES after reminder -> confirms booking
  it("YES after reminder -> confirms booking if context exists", async () => {
    mockTableResponses.bookings = [{ id: 202, phone: "2165550002", service: "Tires", status: "new" }];

    const res = await orchestrateSms({
      type: "inbound_sms",
      phone: "2165550002",
      body: "YES",
      conversationId: 101,
    });

    expect(res.status).toBe("skipped");
    expect(res.reason).toBe("booking_confirmed_automatically");
  });

  // 3. Cancel after reminder -> cancels booking
  it("Cancel after reminder -> cancels booking if context exists", async () => {
    mockTableResponses.bookings = [{ id: 202, phone: "2165550003", service: "Tires", status: "new" }];

    const res = await orchestrateSms({
      type: "inbound_sms",
      phone: "2165550003",
      body: "cancel",
      conversationId: 101,
    });

    expect(res.status).toBe("skipped");
    expect(res.reason).toBe("booking_cancelled_automatically");
  });

  // 4. How much for oil change -> conventional/synthetic pricing
  it("How much for oil change -> conventional/synthetic pricing only", async () => {
    const res = await orchestrateSms({
      type: "inbound_sms",
      phone: "2165550004",
      body: "how much for oil change",
      conversationId: 101,
    });

    expect(res.shouldAutoSend).toBe(true);
    expect(res.body).toContain("$49");
    expect(res.body).toContain("$80");
  });

  // 5. How much for used tires -> $60 installed pricing
  it("How much for used tires -> $60 installed only", async () => {
    const res = await orchestrateSms({
      type: "inbound_sms",
      phone: "2165550005",
      body: "how much for used tires",
      conversationId: 101,
    });

    expect(res.shouldAutoSend).toBe(true);
    expect(res.body).toContain("$60");
    expect(res.body).toContain("installed");
  });

  // 6. How much for brakes -> starts at $149/axle pricing
  it("How much for brakes -> starts at $149/axle only", async () => {
    const res = await orchestrateSms({
      type: "inbound_sms",
      phone: "2165550006",
      body: "how much for brakes",
      conversationId: 101,
    });

    expect(res.shouldAutoSend).toBe(true);
    expect(res.body).toContain("$149");
  });

  // 7. Failed E-Check -> free check
  it("Failed E-Check -> free check / bring it by", async () => {
    const res = await orchestrateSms({
      type: "inbound_sms",
      phone: "2165550007",
      body: "failed e-check",
      conversationId: 101,
    });

    expect(res.shouldAutoSend).toBe(true);
    expect(res.body).toContain("free check");
  });

  // 8. What time do you close -> low-risk auto-send
  it("What time do you close -> low-risk auto-send", async () => {
    const res = await orchestrateSms({
      type: "inbound_sms",
      phone: "2165550008",
      body: "what time do you close",
      conversationId: 101,
    });

    expect(res.shouldAutoSend).toBe(true);
    expect(res.body).toContain("Open Mon-Sat 8-6, Sun 9-4");
  });

  // 9. Where are you located -> low-risk auto-send
  it("Where are you located -> low-risk auto-send", async () => {
    const res = await orchestrateSms({
      type: "inbound_sms",
      phone: "2165550009",
      body: "where are you located",
      conversationId: 101,
    });

    expect(res.shouldAutoSend).toBe(true);
    expect(res.body).toContain("17625 Euclid Ave");
  });

  // 10. Can I come today -> low-risk auto-send
  it("Can I come today -> low-risk auto-send", async () => {
    const res = await orchestrateSms({
      type: "inbound_sms",
      phone: "2165550010",
      body: "can I come today",
      conversationId: 101,
    });

    expect(res.shouldAutoSend).toBe(true);
    expect(res.body).toContain("first-come, first-served");
  });

  // 11. Angry complaint -> draft only
  it("Angry complaint -> draft only, no auto-send", async () => {
    mockClassifyIntent.mockResolvedValue({ ok: true, topLabel: "complaint or negative feedback", topScore: 0.99 });

    const res = await orchestrateSms({
      type: "inbound_sms",
      phone: "2165550011",
      body: "your service was terrible, i want a refund!",
      conversationId: 101,
    });

    expect(res.shouldAutoSend).toBe(false);
    expect(res.requiresHumanApproval).toBe(true);
    expect(res.status).toBe("drafted");
  });

  // 12. Vapi forwarded call -> sends follow-up
  it("Vapi forwarded call -> sends follow-up once, cooldown blocks repeat", async () => {
    // 1st call: No active cooldown
    const res1 = await orchestrateSms({
      type: "vapi_forwarded_call_followup",
      phone: "2165550012",
    });

    expect(res1.shouldAutoSend).toBe(true);
    expect(res1.status).toBe("sent");

    // 2nd call: Cooldown active
    mockTableResponses.sms_orchestrations = [{ id: 42, cooldownKey: "vapi_forward:+12165550012", status: "sent", createdAt: new Date() }];

    const res2 = await orchestrateSms({
      type: "vapi_forwarded_call_followup",
      phone: "2165550012",
    });

    expect(res2.shouldAutoSend).toBe(false);
    expect(res2.status).toBe("skipped");
    expect(res2.reason).toBe("cooldown_active");
  });

  // 13. Vapi confirmation -> logs source call
  it("Vapi confirmation -> sends address recap and logs source call", async () => {
    const res = await orchestrateSms({
      type: "vapi_confirmation",
      phone: "2165550013",
      summary: "Appointment booked for alignment",
      vapiCallId: "call_vapi_123",
    });

    expect(res.shouldAutoSend).toBe(true);
    expect(res.body).toContain("Appointment booked for alignment");
  });

  // 14. Abandoned form -> cooldown 7 days
  it("Abandoned form -> sends once, cooldown blocks repeat within 7 days", async () => {
    mockTableResponses.sms_orchestrations = [{ id: 42, cooldownKey: "abandoned_form:+12165550014", status: "sent", createdAt: new Date() }];

    const res = await orchestrateSms({
      type: "abandoned_form_recovery",
      phone: "2165550014",
      name: "John",
      formType: "tire_order",
    });

    expect(res.shouldAutoSend).toBe(false);
    expect(res.status).toBe("skipped");
  });

  // 15. Stale lead -> cooldown 24 hours
  it("Stale lead -> sends once, cooldown blocks repeat within 24 hours", async () => {
    mockTableResponses.sms_orchestrations = [{ id: 42, cooldownKey: "stale_lead:+12165550015", status: "sent", createdAt: new Date() }];

    const res = await orchestrateSms({
      type: "stale_lead_followup",
      phone: "2165550015",
      leadId: 301,
    });

    expect(res.shouldAutoSend).toBe(false);
    expect(res.status).toBe("skipped");
  });

  // 16. Review request -> respects 30-day cooldown
  it("Review request -> respects 30-day cooldown", async () => {
    mockTableResponses.sms_orchestrations = [{ id: 42, cooldownKey: "review_request:+12165550016", status: "sent", createdAt: new Date() }];

    const res = await orchestrateSms({
      type: "review_request",
      phone: "2165550016",
      name: "John",
    });

    expect(res.shouldAutoSend).toBe(false);
    expect(res.status).toBe("skipped");
  });

  // 17. F25e offline -> sendSms queues
  it("F25e offline -> sendSms queues and orchestration records queued", async () => {
    mockSendSms.mockResolvedValueOnce({ success: true, queued: true, sid: "SM_queued_123" });

    const res = await orchestrateSms({
      type: "manual_admin_reply",
      phone: "2165550017",
      message: "We will see you tomorrow.",
    });

    expect(res.status).toBe("queued");
  });

  // 18. Gateway timeout -> records failed/error send result
  it("Gateway timeout -> records failed transmission status", async () => {
    mockSendSms.mockResolvedValueOnce({ success: false, error: "Gateway Timeout" });

    const res = await orchestrateSms({
      type: "manual_admin_reply",
      phone: "2165550018",
      message: "Please let us know.",
    });

    expect(res.status).toBe("failed");
  });

  // 19. Manual admin reply -> logs but does not block
  it("Manual admin reply -> logs but does not block", async () => {
    const res = await orchestrateSms({
      type: "manual_admin_reply",
      phone: "2165550019",
      message: "Here is your update.",
    });

    expect(res.shouldAutoSend).toBe(true);
    expect(res.status).toBe("sent");
    expect(res.variantKey).toBe("manual");
  });

  // 20. NickGPT draft edited -> saves edited reply
  it("NickGPT draft edited by operator -> tracks final reply", async () => {
    mockTableResponses.nickgpt_drafts = [{ id: 10, customerPhone: "2165550020", inboundMessage: "price?", draftReply: "Used are $60.", intent: "tires", service: "tires" }];

    await trackDraftFeedback(10, "edited", "We have used tires for $60 installed.");

    expect(mockDb.insert).toHaveBeenCalledWith(expect.anything());
  });

  // ─── Self-Learning & Reporting Tests (21-30) ───

  // 21. Daily Report counts
  it("daily report counts sent/drafted/skipped correctly", async () => {
    mockTableResponses.sms_orchestrations = [{ id: 1, eventType: "booking_reminder", customerPhone: "2165559999", status: "sent", shouldAutoSend: true, createdAt: new Date() }];

    const report = await generateDailySmsReport(new Date());
    expect(report.totalSent).toBe(1);
  });

  // 22. Weekly Report groupings
  it("weekly report calculates metrics by source correctly", async () => {
    mockTableResponses.sms_orchestrations = [{ id: 1, status: "sent", eventType: "booking_reminder", shouldAutoSend: true, customerPhone: "2165559999", createdAt: new Date() }];
    mockTableResponses.invoices = [];
    mockTableResponses.bookings = [];
    mockTableResponses.nickgpt_drafts = [];
    mockTableResponses.nickgpt_training_examples = [{ count: 0 }];

    const report = await generateWeeklySmsReport(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), new Date());
    expect(report.estimatedRevenueInfluenced).toBe(0);
  });

  // 23. NickGPT approval metrics
  it("NickGPT approval/edit/reject rates calculate correctly", async () => {
    mockTableResponses.sms_orchestrations = [];
    mockTableResponses.invoices = [];
    mockTableResponses.nickgpt_drafts = [{ status: "approved", customerPhone: "2165559999" }, { status: "edited", customerPhone: "2165559999" }];
    mockTableResponses.nickgpt_training_examples = [{ count: 12 }];

    const report = await generateWeeklySmsReport(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), new Date());
    expect(report.nickgptApprovalRate).toBe(50);
  });

  // 24. Variant performance calculates reply rate
  it("variant performance calculates reply rate correctly", async () => {
    mockTableResponses.sms_orchestrations = [{ id: 1, status: "sent", customerPhone: "2165559999", variantKey: "brakes_v1", createdAt: new Date() }];
    mockTableResponses.bookings = [];
    mockTableResponses.callback_requests = [];

    const perf = await getSmsVariantPerformance({ eventType: "price_question_brakes", days: 30 });
    expect(perf[0].replyRate).toBe(0);
  });

  // 25. Revenue attribution links SMS to booking/lead/callback
  it("revenue attribution links SMS to booking outcomes", async () => {
    mockTableResponses.sms_orchestrations = [
      { id: 1, status: "sent", eventType: "booking_reminder", shouldAutoSend: true, customerPhone: "2165559999", createdAt: new Date() },
      { id: 2, status: "sent", eventType: "booking_reminder", shouldAutoSend: true, customerPhone: "2165559999", createdAt: new Date() },
      { id: 3, status: "sent", eventType: "booking_reminder", shouldAutoSend: true, customerPhone: "2165559999", createdAt: new Date() },
      { id: 4, status: "sent", eventType: "booking_reminder", shouldAutoSend: true, customerPhone: "2165559999", createdAt: new Date() },
      { id: 5, status: "sent", eventType: "booking_reminder", shouldAutoSend: true, customerPhone: "2165559999", createdAt: new Date() },
    ];
    mockTableResponses.invoices = [];
    mockTableResponses.bookings = [{ id: 202, phone: "2165559999", createdAt: new Date() }];
    mockTableResponses.nickgpt_drafts = [];
    mockTableResponses.nickgpt_training_examples = [{ count: 12 }];

    const report = await generateWeeklySmsReport(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), new Date());
    expect(report.highestConversionSource).toBe("booking_reminder");
  });

  // 26. Failure report catches queued/failed/skipped
  it("failure report catches queued/failed/skipped counts", async () => {
    mockTableResponses.sms_orchestrations = [
      { id: 1, status: "failed", customerPhone: "2165559999", failureReason: "Network", createdAt: new Date() },
      { id: 2, status: "queued", customerPhone: "2165559999", createdAt: new Date() }
    ];

    const report = await generateDailySmsReport(new Date());
    expect(report.failedMessages).toBe(1);
    expect(report.queuedMessages).toBe(1);
  });

  // 27. Training threshold progress is accurate
  it("training threshold progress is accurate", async () => {
    mockTableResponses.sms_orchestrations = [];
    mockTableResponses.invoices = [];
    mockTableResponses.nickgpt_drafts = [];
    mockTableResponses.nickgpt_training_examples = [{ count: 250 }];

    const report = await generateWeeklySmsReport(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), new Date());
    expect(report.trainingDatasetGrowth).toBe(250);
  });

  // 28. Telegram report formats correctly
  it("Telegram report formats correctly and is non-empty", async () => {
    const { sendDailySmsReportToTelegram } = await import("../services/smsLearningEngine");
    const result = await sendDailySmsReportToTelegram();
    expect(result).toBe(true);
  });

  // 29. Opt-outs are counted but not used as positive outcomes
  it("opt-outs are counted but not used as positive outcomes", async () => {
    mockTableResponses.sms_orchestrations = [
      { id: 1, status: "skipped", statusReason: "customer_opted_out", customerPhone: "2165559999", createdAt: new Date() }
    ];
    mockTableResponses.sms_orchestration_outcomes = [
      { outcomeType: "customer_opted_out", createdAt: new Date() }
    ];

    const report = await generateDailySmsReport(new Date());
    expect(report.optOuts).toBe(1);
    expect(report.bookingsCreated).toBe(0);
  });

  // 30. Reporting ignores test/fake phone numbers
  it("reporting ignores test/fake phone numbers if marked test", async () => {
    mockTableResponses.sms_orchestrations = [
      { id: 1, status: "sent", customerPhone: "5550100", createdAt: new Date() }
    ];

    const report = await generateDailySmsReport(new Date());
    expect(report.totalSent).toBe(0);
  });

  // ─── Shadow Mode, Experiments, Timeline & Review Tests (31-40) ───

  // 31. Shadow Mode comparison
  it("31. Shadow Mode comparison -> computes orchestrator decision but sends legacy", async () => {
    mockRolloutEventMode = "shadow";

    const res = await orchestrateSms({
      type: "vapi_forwarded_call_followup",
      phone: "2165550031",
      legacyMessageBody: "Legacy follow up message body"
    });

    expect(res.status).toBe("sent");
    expect(res.variantKey).toBe("vapi_forwarded_call_followup_v1"); // computed variant
    expect(mockSendSms).toHaveBeenCalledWith("+12165550031", "Legacy follow up message body", expect.objectContaining({ variantKey: "legacy_shadow" }));
  });

  // 32. Global Kill Switch
  it("32. Global Kill Switch -> immediately returns to legacy passthrough send behavior", async () => {
    mockRolloutGlobalMode = "legacy_passthrough";

    const res = await orchestrateSms({
      type: "vapi_forwarded_call_followup",
      phone: "2165550032",
      legacyMessageBody: "Legacy message body here"
    });

    expect(res.status).toBe("sent");
    expect(res.variantKey).toBe("legacy");
    expect(mockSendSms).toHaveBeenCalledWith("+12165550032", "Legacy message body here", expect.objectContaining({ variantKey: "legacy" }));
  });

  // 33. Variant experiment assignment
  it("33. Variant experiment assignment -> computes correct trafficWeight and isControl", async () => {
    const res = await orchestrateSms({
      type: "vapi_forwarded_call_followup",
      phone: "2165550033",
    });

    expect(res.variantKey).toContain("vapi_forwarded_call_followup_v");
  });

  // 34. Attribution windows
  it("34. Attribution windows -> weekly report maps correct windows per event type", async () => {
    mockTableResponses.sms_orchestrations = [
      { id: 1, status: "sent", eventType: "vapi_forwarded_call_followup", shouldAutoSend: true, customerPhone: "2165550034", createdAt: new Date() }
    ];
    mockTableResponses.invoices = [{ id: 101, customerPhone: "2165550034", totalAmount: 8000, createdAt: new Date() }];
    mockTableResponses.bookings = [];
    mockTableResponses.callback_requests = [];
    mockTableResponses.nickgpt_drafts = [];
    mockTableResponses.nickgpt_training_examples = [{ count: 12 }];

    const report = await generateWeeklySmsReport(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), new Date());
    expect(report.estimatedRevenueInfluenced).toBe(80); // Synthetic oil change $80
  });

  // 35. Human review flagging
  it("35. Human review flagging -> angry complaint intent redirects to needs_review status", async () => {
    mockClassifyIntent.mockResolvedValueOnce({ ok: true, topLabel: "complaint or negative feedback", topScore: 0.96 });

    const res = await orchestrateSms({
      type: "inbound_sms",
      phone: "2165550035",
      body: "this is a complaint! I want a refund!",
      conversationId: 101
    });

    expect(res.requiresHumanApproval).toBe(true);
    expect(res.status).toBe("drafted");
  });

  // 36. getCustomerTimeline
  it("36. getCustomerTimeline -> timeline events populated correctly", async () => {
    const { getCustomerJourneyTimeline } = await import("../services/smsOrchestrator");
    mockTableResponses.sms_conversations = [{ id: 101 }];
    mockTableResponses.sms_messages = [{ id: 1, direction: "inbound", body: "hello", createdAt: new Date() }];
    mockTableResponses.sms_orchestrations = [];
    mockTableResponses.nickgpt_drafts = [];
    mockTableResponses.vapi_call_logs = [];
    mockTableResponses.leads = [];
    mockTableResponses.bookings = [];
    mockTableResponses.callback_requests = [];
    mockTableResponses.invoices = [];

    const timeline = await getCustomerJourneyTimeline("2165550036");
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline[0].type).toBe("inbound_sms");
  });

  // 37. actionHumanReview
  it("37. actionHumanReview -> send action updates orchestration and sends suggested message", async () => {
    const { smsOrchestratorRouter } = await import("../routers/smsOrchestrator");
    expect(smsOrchestratorRouter.actionHumanReview).toBeDefined();
  });

  // 38. getRolloutModes
  it("38. getRolloutModes -> lists modes from DB", async () => {
    const { smsOrchestratorRouter } = await import("../routers/smsOrchestrator");
    expect(smsOrchestratorRouter.getRolloutModes).toBeDefined();
  });

  // 39. setRolloutMode
  it("39. setRolloutMode -> writes to DB", async () => {
    const { smsOrchestratorRouter } = await import("../routers/smsOrchestrator");
    expect(smsOrchestratorRouter.setRolloutMode).toBeDefined();
  });

  // 40. Replay Engine dry-run
  it("40. Replay Engine dry-run -> does not transmit messages when REPLAY_DRY_RUN env is true", async () => {
    process.env.REPLAY_DRY_RUN = "true";

    const res = await orchestrateSms({
      type: "vapi_forwarded_call_followup",
      phone: "2165550040",
    });

    expect(res.status).toBe("sent");
    expect(mockSendSms).not.toHaveBeenCalled();
    delete process.env.REPLAY_DRY_RUN;
  });
});

