import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("./consentLedger");

let executeImpl: (...args: unknown[]) => Promise<unknown> = async () => [[]];
vi.mock("../lib/db-helper", () => ({
  db: vi.fn(async () => ({ execute: (...args: unknown[]) => executeImpl(...args) })),
}));

import {
  appendConsentEvent,
  getConsentLedgerMode,
  loadConsentLedgerSnapshot,
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

async function invalidateCacheThroughPublicWrite(): Promise<void> {
  executeImpl = async () => [[]];
  const result = await appendConsentEvent({
    subjectType: "phone",
    subjectKey: "2165550198",
    scope: "sms_informational",
    action: "grant",
    source: "test_cache_reset",
    method: "api",
    evidenceRef: "test:cache-reset",
    actor: "system:test",
  });
  expect(result.status).toBe("written");
}

async function project(events: ConsentEventRow[]) {
  executeImpl = async () => [events];
  const result = await loadConsentLedgerSnapshot("shadow");
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  expect(result.available).toBe(true);
  return result.snapshot;
}

beforeEach(async () => {
  process.env.CONSENT_LEDGER_MODE = "shadow";
  await invalidateCacheThroughPublicWrite();
});

afterEach(() => {
  delete process.env.CONSENT_LEDGER_MODE;
  vi.clearAllMocks();
});

describe("consent state projection through the public snapshot API", () => {
  it("STOP then later START restores all scopes", async () => {
    const snapshot = await project([
      event({ id: 1, subjectKey: "+1 (216) 555-0100", action: "revoke", occurredAt: "2026-09-26T12:00:00Z" }),
      event({ id: 2, subjectKey: "+1 (216) 555-0100", action: "grant", occurredAt: "2026-09-26T12:01:00Z" }),
    ]);
    expect(snapshot.revokedSmsPhones.has("2165550100")).toBe(false);
    expect(snapshot.grantsByPhone.get("2165550100")?.has("sms_marketing")).toBe(true);
  });

  it("a hold clears only after a later release", async () => {
    const snapshot = await project([
      event({ id: 1, action: "hold" }),
      event({ id: 2, action: "release", occurredAt: "2026-09-26T12:01:00Z" }),
    ]);
    expect(snapshot.heldPhones.has("2165550100")).toBe(false);
  });

  it("a later revoke wins over a hold", async () => {
    const snapshot = await project([
      event({ id: 1, action: "hold" }),
      event({ id: 2, action: "revoke", occurredAt: "2026-09-26T12:01:00Z" }),
    ]);
    expect(snapshot.heldPhones.has("2165550100")).toBe(false);
    expect(snapshot.revokedSmsPhones.has("2165550100")).toBe(true);
  });

  it("revoke wins a same-instant tie against grant", async () => {
    const at = "2026-09-26T12:00:00.000Z";
    const snapshot = await project([
      event({ id: 9, action: "grant", occurredAt: at }),
      event({ id: 2, action: "revoke", occurredAt: at }),
    ]);
    expect(snapshot.revokedSmsPhones.has("2165550100")).toBe(true);
  });

  it("voice-only revocation does not become an SMS revocation", async () => {
    const snapshot = await project([
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

  it("normalizes phone keys and truncates evidence before SQL", async () => {
    let values: unknown[] = [];
    executeImpl = async (statement) => {
      const chunks = (statement as { queryChunks?: Array<Record<string, unknown>> }).queryChunks ?? [];
      values = chunks.flatMap((chunk) => {
        if (typeof chunk === "string" || typeof chunk === "number" || typeof chunk === "boolean") return [chunk];
        if (chunk && typeof chunk === "object" && "value" in chunk && !Array.isArray(chunk.value)) {
          return [chunk.value];
        }
        return [];
      });
      return [[]];
    };

    const result = await appendConsentEvent({
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

    expect(result.status).toBe("written");
    expect(values).toContain("2165550199");
    expect(values).toContain("x".repeat(191));
    expect(values).toContain("y".repeat(160));
    expect(values).toContain("u".repeat(300));
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
