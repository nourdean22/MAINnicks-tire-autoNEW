import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("./sms");
vi.unmock("./services/complianceLog");

const state = vi.hoisted(() => ({
  auditRows: [] as Array<{ actor: string }>,
  grants: new Map<string, Set<string>>(),
}));

vi.mock("./services/consentLedger", () => ({
  getConsentLedgerMode: (raw = process.env.CONSENT_LEDGER_MODE) => {
    const value = (raw ?? "off").trim().toLowerCase();
    return value === "shadow" || value === "enforce_holds" || value === "enforce_grants" ? value : "off";
  },
  isConsentHoldEnforced: (mode = process.env.CONSENT_LEDGER_MODE) =>
    mode === "enforce_holds" || mode === "enforce_grants",
  appendConsentEvent: vi.fn(async (input: { subjectKey: string; scope: string; action: string }) => {
    if (input.action === "grant") {
      const phone = input.subjectKey.replace(/\D/g, "").slice(-10);
      const scopes = state.grants.get(phone) ?? new Set<string>();
      if (input.scope === "all") {
        scopes.add("sms_conversational");
        scopes.add("sms_informational");
        scopes.add("sms_marketing");
      } else {
        scopes.add(input.scope);
      }
      state.grants.set(phone, scopes);
    }
    return { status: "written" as const };
  }),
  loadConsentLedgerSnapshot: vi.fn(async () => ({
    ok: true as const,
    available: true,
    stale: false,
    snapshot: {
      revokedSmsPhones: new Set<string>(),
      heldPhones: new Set<string>(),
      grantsByPhone: new Map(
        [...state.grants.entries()].map(([phone, scopes]) => [phone, new Set(scopes)]),
      ),
      eventCount: [...state.grants.values()].reduce((sum, scopes) => sum + scopes.size, 0),
    },
  })),
}));

vi.mock("./lib/db-helper", () => ({
  db: vi.fn(async () => ({
    insert: () => ({
      values: async (row: { action?: string; actor?: string }) => {
        if (row.action === "sms.opt_in" && row.actor) state.auditRows.push({ actor: row.actor });
        return [];
      },
    }),
    select: () => ({
      from: () => ({
        where: async () => state.auditRows,
      }),
    }),
  })),
}));

vi.mock("./services/smsControl", () => ({
  getSmsPauseState: vi.fn(async () => ({ paused: false, readable: true })),
  checkGlobalDailyCap: vi.fn(async () => ({ allowed: true, count: 0, cap: 200, readable: true })),
  isPhoneHumanHeld: vi.fn(async () => false),
  SMS_GLOBAL_PAUSE_FLAG: "sms_global_pause",
}));

vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: () => Object.assign(Promise.resolve([] as unknown[]), { limit: async () => [] }),
      }),
    }),
    insert: () => ({ values: () => ({ $returningId: async () => [{ id: 777 }] }) }),
    update: () => ({ set: () => ({ where: async () => [{ affectedRows: 1 }] }) }),
    execute: async () => [[]],
  }),
  getOrCreateConversation: async () => ({ id: 1 }),
  addSmsMessage: async () => undefined,
}));

const mockTwilioCreate = vi.fn().mockResolvedValue({ sid: "SM_q43_marketing" });
vi.mock("twilio", () => ({
  default: () => ({ messages: { create: mockTwilioCreate } }),
}));

const INFO_PHONE = "+12165550191";
const MARKETING_PHONE = "+12165550192";
const ENV_KEYS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "SHOP_SMS_GATEWAY_USERNAME",
  "SHOP_SMS_GATEWAY_PASSWORD",
  "SMS_KILL_SWITCH",
  "SMS_CONSENT_GATE",
  "CONSENT_LEDGER_MODE",
] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-26T16:00:00.000Z"));
  state.auditRows.length = 0;
  state.grants.clear();
  mockTwilioCreate.mockClear();

  delete process.env.SHOP_SMS_GATEWAY_USERNAME;
  delete process.env.SHOP_SMS_GATEWAY_PASSWORD;
  delete process.env.SMS_KILL_SWITCH;
  process.env.TWILIO_ACCOUNT_SID = "AC_q43";
  process.env.TWILIO_AUTH_TOKEN = "tok_q43";
  process.env.TWILIO_PHONE_NUMBER = "+12165550100";
  process.env.SMS_CONSENT_GATE = "enforce";
  process.env.CONSENT_LEDGER_MODE = "shadow";

  const { __resetConsentIndexCacheForTests } = await import("./services/complianceLog");
  __resetConsentIndexCacheForTests();
});

afterEach(() => {
  vi.useRealTimers();
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Q43 purpose-scoped marketing consent canary", () => {
  it("an informational booking grant cannot authorize marketing even when legacy audit_log says opted in", async () => {
    const { getSmsOptInIndex, logSmsOptIn } = await import("./services/complianceLog");

    // Preload an empty derived marketing cache. The reviewed bug mutated this
    // Set in-place from logSmsOptIn, turning an informational grant into a
    // five-minute marketing grant.
    expect((await getSmsOptInIndex()).ok).toBe(true);

    await logSmsOptIn({
      phone: INFO_PHONE,
      source: "booking_form",
      evidenceRef: "booking:191",
      ledgerScope: "sms_informational",
      ledgerMethod: "web_submit_implicit",
    });

    expect(state.auditRows.some((row) => row.actor.endsWith("2165550191"))).toBe(true);
    expect(state.grants.get("2165550191")?.has("sms_marketing")).not.toBe(true);

    const { sendSms } = await import("./sms");
    const result = await sendSms(INFO_PHONE, "Come back for tires this week", {
      messageClass: "customer_marketing",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no sms consent on file/i);
    expect(mockTwilioCreate).not.toHaveBeenCalled();
  });

  it("a real sms_marketing grant still authorizes the enforced marketing path", async () => {
    const { getSmsOptInIndex, logSmsOptIn } = await import("./services/complianceLog");
    expect((await getSmsOptInIndex()).ok).toBe(true);

    await logSmsOptIn({
      phone: MARKETING_PHONE,
      source: "marketing_checkbox",
      evidenceRef: "marketing-form:192",
      ledgerScope: "sms_marketing",
      ledgerMethod: "web_checkbox",
    });

    const { sendSms } = await import("./sms");
    const result = await sendSms(MARKETING_PHONE, "Tire special this week", {
      messageClass: "customer_marketing",
    });

    expect(result.success).toBe(true);
    expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
  });
});
