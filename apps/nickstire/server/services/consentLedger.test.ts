import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("./consentLedger");

let executeImpl: (...args: unknown[]) => Promise<unknown> = async () => [[]];
vi.mock("../lib/db-helper", () => ({
  db: vi.fn(async () => ({ execute: (...args: unknown[]) => executeImpl(...args) })),
}));

import {
  __resetConsentLedgerCacheForTests,
  buildConsentLedgerSnapshot,
  deriveContactState,
  getConsentLedgerMode,
  loadConsentLedgerSnapshot,
  prepareConsentEvent,
  type ConsentEventRow,
} from "./consentLedger";

const event = (overrides: Partial<ConsentEventRow>): ConsentEventRow => ({
  id: 1,
  subjectType: "phone",
  subjectKey: "2165550100",
  scope: "all",
  action: "grant",
  source: "test",
  method: "sms_reply",
  evidenceRef: "sms:1",
  actor: "system:test",
  occurredAt: "2026-09-26T12:00:00.000Z",
  ...overrides,
});

beforeEach(() => {
  process.env.CONSENT_LEDGER_MODE = "shadow";
  executeImpl = async () => [[]];
  __resetConsentLedgerCacheForTests();
});

afterEach(() => {
  delete process.env.CONSENT_LEDGER_MODE;
  vi.clearAllMocks();
});

describe("deriveContactState", () => {
  it("STOP then later START restores all scopes", () => {
    const state = deriveContactState([
      event({ id: 1, action: "revoke", occurredAt: "2026-09-26T12:00:00Z" }),
      event({ id: 2, action: "grant", occurredAt: "2026-09-26T12:01:00Z" }),
    ]);
    expect(state.revokedScopes.size).toBe(0);
  });

  it("a hold clears only after a later release", () => {
    expect(deriveContactState([event({ action: "hold" })]).held).toBe(true);
    expect(deriveContactState([
      event({ id: 1, action: "hold" }),
      event({ id: 2, action: "release", occurredAt: "2026-09-26T12:01:00Z" }),
    ]).held).toBe(false);
  });

  it("a later revoke wins over a hold", () => {
    const state = deriveContactState([
      event({ id: 1, action: "hold" }),
      event({ id: 2, action: "revoke", occurredAt: "2026-09-26T12:01:00Z" }),
    ]);
    expect(state.held).toBe(false);
    expect(state.revokedScopes.has("sms_marketing")).toBe(true);
  });

  it("revoke wins a same-instant tie against grant", () => {
    const at = "2026-09-26T12:00:00.000Z";
    const state = deriveContactState([
      event({ id: 9, action: "grant", occurredAt: at }),
      event({ id: 2, action: "revoke", occurredAt: at }),
    ]);
    expect(state.revokedScopes.has("sms_marketing")).toBe(true);
  });

  it("voice-only revocation does not become an SMS revocation", () => {
    const snapshot = buildConsentLedgerSnapshot([
      event({ action: "revoke", scope: "voice_ai_marketing" }),
    ]);
    expect(snapshot.revokedSmsPhones.size).toBe(0);
  });
});

describe("rollout contract", () => {
  it("defaults to off and accepts only named modes", () => {
    delete process.env.CONSENT_LEDGER_MODE;
    expect(getConsentLedgerMode()).toBe("off");
    expect(getConsentLedgerMode("shadow")).toBe("shadow");
    expect(getConsentLedgerMode("garbage")).toBe("off");
  });

  it("normalizes phone keys and truncates evidence before SQL", () => {
    const prepared = prepareConsentEvent({
      subjectType: "phone",
      subjectKey: "+1 (216) 555-0199",
      scope: "sms_informational",
      action: "grant",
      source: "booking_form",
      method: "web_submit_implicit",
      evidenceRef: "x".repeat(300),
      evidenceExcerpt: "y".repeat(300),
      userAgent: "u".repeat(500),
      actor: "system:booking",
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.event.subjectKey).toBe("2165550199");
    expect(prepared.event.evidenceRef).toHaveLength(191);
    expect(prepared.event.evidenceExcerpt).toHaveLength(160);
    expect(prepared.event.userAgent).toHaveLength(300);
  });

  it("shadow tolerates only a genuinely missing table", async () => {
    executeImpl = async () => {
      const err = new Error("Table missing") as Error & { code?: string; errno?: number };
      err.code = "ER_NO_SUCH_TABLE";
      err.errno = 1146;
      throw err;
    };
    const result = await loadConsentLedgerSnapshot("shadow");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.available).toBe(false);
  });

  it("enforce_holds fails closed when the migration is missing", async () => {
    executeImpl = async () => {
      const err = new Error("Table missing") as Error & { code?: string; errno?: number };
      err.code = "ER_NO_SUCH_TABLE";
      err.errno = 1146;
      throw err;
    };
    expect(await loadConsentLedgerSnapshot("enforce_holds")).toEqual({
      ok: false,
      reason: "consent ledger migration pending",
    });
  });

  it("a non-schema read error fails closed even in shadow", async () => {
    executeImpl = async () => {
      const err = new Error("connection lost") as Error & { code?: string };
      err.code = "ECONNRESET";
      throw err;
    };
    expect((await loadConsentLedgerSnapshot("shadow")).ok).toBe(false);
  });
});
