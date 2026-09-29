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

const INBOUND = "hey do you guys do alignments on a pickup truck";
const DRAFT_FINISHED = "Yes, we do alignments on trucks. Want to bring it by this week?";
const DRAFT_CUT = "Yes, we do alignments on trucks. We can usually get you in the same day if you";

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
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("an unknown stop signal is held too — unknown is not finished", async () => {
    mockDraftSmsReply.mockResolvedValue(draft(DRAFT_FINISHED, "unknown"));
    const res = await inbound();
    expect(res.shouldAutoSend).toBe(false);
    expect(res.reason).toBe("draft_completion_unknown");
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("a truncated complaint is held and keeps its complaint reason", async () => {
    mockClassifyIntent.mockResolvedValue({ ok: true, topLabel: "complaint or negative feedback", topScore: 0.99 });
    mockDraftSmsReply.mockResolvedValue(draft(DRAFT_CUT, "truncated"));
    const res = await inbound();
    expect(res.shouldAutoSend).toBe(false);
    expect(res.reason).toBe("high_risk_complaint_detected");
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("a result with no completion field at all (older contract) is held", async () => {
    mockDraftSmsReply.mockResolvedValue(draft(DRAFT_FINISHED));
    const res = await inbound();
    expect(res.shouldAutoSend).toBe(false);
    expect(mockSendSms).not.toHaveBeenCalled();
  });
});
