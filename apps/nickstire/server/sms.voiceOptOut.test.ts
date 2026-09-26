/**
 * Q-45 · a do-not-call request SPOKEN on an outbound AI call lands in the SAME
 * opt-out store every lane reads, with the scope this PR chose:
 *
 *   · every AI-voice lane and every marketing / recovery / follow-up text is
 *     suppressed — the number is in `phones`, which all of them consult;
 *   · a `customer_confirmation` text (a verification code, their own car's
 *     status) still goes — "stop calling" does not cover a text they asked for;
 *   · any FULL opt-out for the same number (a text STOP, customers.smsOptOut)
 *     wins, and the voice write never downgrades one.
 *
 * The DB is a stub routed on the table each query reads; the SQL the writer
 * sends is captured and pinned.
 *
 * RED ON MAIN (measured, 5 of 8): `markPhoneVoiceOptedOut` and `voiceOnly` do
 * not exist, and main refuses the confirmation text too. The two marketing /
 * follow-up refusals PASS on main — main refuses every text to an opted-out
 * number — so they are regression guards on the narrower scope, not new
 * behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

vi.unmock("../sms");

const ledgerState = vi.hoisted(() => ({
  revokedSmsPhones: new Set<string>(),
  heldPhones: new Set<string>(),
  grantsByPhone: new Map<string, Set<string>>(),
}));

vi.mock("./services/consentLedger", () => ({
  getConsentLedgerMode: (raw = process.env.CONSENT_LEDGER_MODE) => {
    const value = (raw ?? "off").trim().toLowerCase();
    return value === "shadow" || value === "enforce_holds" || value === "enforce_grants" ? value : "off";
  },
  isConsentHoldEnforced: (mode = process.env.CONSENT_LEDGER_MODE) =>
    mode === "enforce_holds" || mode === "enforce_grants",
  loadConsentLedgerSnapshot: vi.fn(async (mode = process.env.CONSENT_LEDGER_MODE ?? "off") => ({
    ok: true as const,
    available: mode !== "off",
    stale: false,
    snapshot: {
      revokedSmsPhones: new Set(ledgerState.revokedSmsPhones),
      heldPhones: new Set(ledgerState.heldPhones),
      grantsByPhone: new Map(ledgerState.grantsByPhone),
      eventCount: ledgerState.revokedSmsPhones.size + ledgerState.heldPhones.size,
    },
  })),
}));

const mockTwilioCreate = vi.fn().mockResolvedValue({ sid: "SM_voice_optout" });
vi.mock("twilio", () => ({ default: () => ({ messages: { create: mockTwilioCreate } }) }));

const VOICE_ONLY = "2165550161";
const VOICE_AND_STOP = "2165550162";

let prefRows: Array<{ phone: string; keyword: string | null }> = [];
let customerRows: Array<{ phone: string }> = [];
let executed: string[] = [];
let persistedRows: Array<{ row: Record<string, unknown>; set: Record<string, unknown> }> = [];

// Routed on the TABLE, not on the selected columns: the same stub must serve
// main's query shape (phone only) and this branch's (phone + keyword), or the
// red-on-main run measures the stub instead of the code.
vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({
      from: (table: object) => ({
        where: async () => (getTableName(table as never) === "sms_preferences" ? prefRows : customerRows),
      }),
    }),
    execute: async (q: { queryChunks?: unknown[] }) => {
      executed.push(JSON.stringify(q?.queryChunks ?? q));
      return [[]];
    },
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        onDuplicateKeyUpdate: async (update: { set: Record<string, unknown> }) => {
          persistedRows.push({ row, set: update.set });
        },
      }),
    }),
  }),
}));

const ENV_KEYS = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "SMS_KILL_SWITCH", "CONSENT_LEDGER_MODE"] as const;
const ORIG: Record<string, string | undefined> = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  vi.resetModules();
  mockTwilioCreate.mockClear();
  prefRows = [];
  customerRows = [];
  executed = [];
  persistedRows = [];
  ledgerState.revokedSmsPhones.clear();
  ledgerState.heldPhones.clear();
  ledgerState.grantsByPhone.clear();
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "tok_test";
  process.env.TWILIO_PHONE_NUMBER = "+12165550100";
  delete process.env.SMS_KILL_SWITCH;
  delete process.env.CONSENT_LEDGER_MODE;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = ORIG[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("the suppression index", () => {
  it("a VOICE row suppresses the number AND is marked voice-only; a full source for the same number wins", async () => {
    prefRows = [
      { phone: VOICE_ONLY, keyword: "VOICE" },
      { phone: VOICE_AND_STOP, keyword: "VOICE" },
    ];
    customerRows = [{ phone: VOICE_AND_STOP }];
    const { loadSuppressionIndex } = await import("./sms");
    const idx = await loadSuppressionIndex();
    if (!idx.ok) throw new Error(idx.reason);
    expect(idx.phones.has(VOICE_ONLY)).toBe(true);
    expect(idx.phones.has(VOICE_AND_STOP)).toBe(true);
    expect([...idx.voiceOnly]).toEqual([VOICE_ONLY]);
  });

  it("POSITIVE CONTROL: a keyword-less opted-out row (a text STOP) is a FULL opt-out, not voice-only", async () => {
    prefRows = [{ phone: VOICE_ONLY, keyword: null }];
    const { loadSuppressionIndex } = await import("./sms");
    const idx = await loadSuppressionIndex();
    if (!idx.ok) throw new Error(idx.reason);
    expect(idx.phones.has(VOICE_ONLY)).toBe(true);
    expect(idx.voiceOnly.size).toBe(0);
  });

  it("Q43 ledger revocations are a real suppression source when rollout is enabled", async () => {
    process.env.CONSENT_LEDGER_MODE = "shadow";
    ledgerState.revokedSmsPhones.add(VOICE_ONLY);

    const { loadSuppressionIndex } = await import("./sms");
    const idx = await loadSuppressionIndex();
    if (!idx.ok) throw new Error(idx.reason);

    expect(prefRows).toEqual([]);
    expect(customerRows).toEqual([]);
    expect(idx.phones.has(VOICE_ONLY)).toBe(true);
    expect(idx.voiceOnly.has(VOICE_ONLY)).toBe(false);
  });

  it("Q43 ledger holds become a real suppression source at enforce_holds", async () => {
    process.env.CONSENT_LEDGER_MODE = "enforce_holds";
    ledgerState.heldPhones.add(VOICE_ONLY);

    const { loadSuppressionIndex } = await import("./sms");
    const idx = await loadSuppressionIndex();
    if (!idx.ok) throw new Error(idx.reason);

    expect(idx.phones.has(VOICE_ONLY)).toBe(true);
    expect(idx.voiceOnly.has(VOICE_ONLY)).toBe(false);
  });

  it("message-history STOP suppression is released by a later START-family inbound", async () => {
    const { loadSuppressionIndex } = await import("./sms");
    const idx = await loadSuppressionIndex();
    if (!idx.ok) throw new Error(idx.reason);

    const sqlText = executed.join("\n");
    expect(sqlText).toContain("NOT EXISTS");
    expect(sqlText).toContain("START");
    expect(sqlText).toContain("UNSTOP");
    expect(sqlText).toContain("YES");
    expect(sqlText).toContain("mi.createdAt > m.createdAt");
  });
});

describe("sendSms honours the voice opt-out's scope", () => {
  beforeEach(() => {
    prefRows = [{ phone: VOICE_ONLY, keyword: "VOICE" }];
  });

  it.each(["customer_marketing", "customer_followup"] as const)("%s to a voice-opted-out number is REFUSED", async (messageClass) => {
    const { sendSms } = await import("./sms");
    const res = await sendSms(`+1${VOICE_ONLY}`, "Still thinking about those brakes?", { messageClass });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/opted out/i);
    expect(mockTwilioCreate).not.toHaveBeenCalled();
  });

  it("customer_confirmation to a voice-opted-out number passes the opt-out gate", async () => {
    const { sendSms } = await import("./sms");
    const res = await sendSms(`+1${VOICE_ONLY}`, "Your verification code is 123456.", { messageClass: "customer_confirmation" });
    expect(res.error ?? "").not.toMatch(/opted out|cannot verify/i);
  });

  it("customer_confirmation is still REFUSED once the same number also has a full opt-out", async () => {
    customerRows = [{ phone: VOICE_ONLY }];
    const { sendSms } = await import("./sms");
    const res = await sendSms(`+1${VOICE_ONLY}`, "Your verification code is 123456.", { messageClass: "customer_confirmation" });
    expect(res.error).toMatch(/opted out/i);
  });
});

describe("markPhoneFullyOptedOut", () => {
  it("persists an all-contact opt-out without the VOICE marker and reports durability", async () => {
    const { markPhoneFullyOptedOut } = await import("./sms");
    expect(await markPhoneFullyOptedOut("+1 (216) 555-0161")).toBe(true);
    expect(persistedRows).toHaveLength(1);
    expect(persistedRows[0]!.row).toMatchObject({
      phone: VOICE_ONLY,
      optedOut: true,
      optOutKeyword: null,
    });
    expect(persistedRows[0]!.set).toMatchObject({
      optedOut: true,
      optOutKeyword: null,
    });
  });
});

describe("markPhoneVoiceOptedOut", () => {
  it("writes the existing sms_preferences store with the VOICE marker, and never downgrades a prior opt-out", async () => {
    const { markPhoneVoiceOptedOut, loadSuppressionIndex } = await import("./sms");
    expect(await markPhoneVoiceOptedOut("+1 (216) 555-0161")).toBe(true);
    const sqlText = executed.find((q) => q.includes("INSERT INTO sms_preferences")) ?? "";
    expect(sqlText).toContain("opt_out_keyword = IF(opted_out, opt_out_keyword, ");
    expect(sqlText).toContain("opted_out = 1");
    // `opted_out` is assigned LAST, so both IFs read the row's old value.
    expect(sqlText.lastIndexOf("opted_out = 1")).toBeGreaterThan(sqlText.lastIndexOf("IF(opted_out, opted_out_at"));
    expect(sqlText).toContain(VOICE_ONLY);
    // The index built afterwards sees it (the writer also updated this process's cache).
    prefRows = [{ phone: VOICE_ONLY, keyword: "VOICE" }];
    const idx = await loadSuppressionIndex();
    expect(idx.ok && idx.phones.has(VOICE_ONLY)).toBe(true);
  });

  it("rejects a number that is not 10 digits without writing", async () => {
    const { markPhoneVoiceOptedOut } = await import("./sms");
    expect(await markPhoneVoiceOptedOut("12345")).toBe(false);
    expect(executed.some((q) => q.includes("INSERT INTO sms_preferences"))).toBe(false);
  });
});
