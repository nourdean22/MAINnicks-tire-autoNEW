/**
 * Customer-language miner.
 *
 * The test that matters is the PII one, and its instrument is `redactedTokens`:
 * the output is vocabulary-only by construction, so "no PII in the output"
 * would stay green with the scrubber deleted. Asserting the count proves the
 * scrubber FIRED (positive-control-first: with scrubRow returning its input
 * unchanged, "redactedTokens" fails `expected 0 to be greater than or equal to
 * 7` and the phone fixture fails `expected 0 to be 1`).
 *
 * Fixture PII uses the NANP fiction exchange (555), example.com, and a
 * made-up VIN — nothing here is a real person.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getDb: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("../db", () => ({ getDb: h.getDb }));

import {
  mineCustomerLanguage,
  mineCustomerLanguageFromRows,
  type CustomerLanguageRow,
} from "./customerLanguageMiner";

const row = (text: string, over: Partial<CustomerLanguageRow> = {}): CustomerLanguageRow => ({
  source: "sms",
  text,
  at: "2026-09-20T15:00:00.000Z",
  ...over,
});

describe("PII never survives aggregation", () => {
  const PLANTED = {
    phone: "216-555-0147",
    email: "jane.doe@example.com",
    name: "Jane Doe",
    vin: "1HGCM82633A004352",
    plate: "ABC 1234",
    street: "1234 Euclid Ave",
  };

  it("phone, email, name, VIN, plate and address are all redacted and counted", () => {
    const text =
      `Hi my name is ${PLANTED.name}, call me at ${PLANTED.phone} or ${PLANTED.email}. ` +
      `VIN ${PLANTED.vin}, plate ${PLANTED.plate}, I live at ${PLANTED.street}. my car shakes when i brake`;
    const out = mineCustomerLanguageFromRows([row(text, { source: "calls", knownNames: [PLANTED.name] })]);
    const json = JSON.stringify(out);
    for (const [kind, value] of Object.entries(PLANTED)) {
      expect(json, `${kind} leaked`).not.toContain(value);
    }
    for (const fragment of ["0147", "Jane", "Doe", "jane", "Euclid", "1HGCM", "ABC"]) {
      expect(json.toLowerCase(), `${fragment} leaked`).not.toContain(fragment.toLowerCase());
    }
    // name (2 tokens) + phone + email + VIN + plate + street = 7
    expect(out.redactedTokens).toBeGreaterThanOrEqual(7);
    expect(out.phrases.map((p) => p.symptomTopic)).toEqual(["brake_shake"]);
  });

  it("the counter is a real instrument: zero on clean text, one per planted phone", () => {
    expect(mineCustomerLanguageFromRows([row("my car shakes when i brake")]).redactedTokens).toBe(0);
    expect(mineCustomerLanguageFromRows([row(`text me at ${PLANTED.phone}, it grinds when i stop`)]).redactedTokens).toBe(1);
  });

  it("a self-introduction without a known name is still stripped", () => {
    const out = mineCustomerLanguageFromRows([row("this is Marcus Williams, battery keeps dying")]);
    expect(JSON.stringify(out)).not.toMatch(/marcus|williams/i);
    expect(out.redactedTokens).toBe(1);
    expect(out.phrases[0]?.symptomTopic).toBe("battery_dies");
  });

  it("the address scrub does not eat a real customer phrase", () => {
    const out = mineCustomerLanguageFromRows([row("I need 4 tires by the way")]);
    expect(out.phrases[0]?.phrase).toBe("4 tires");
    expect(out.redactedTokens).toBe(0);
  });

  it("a known name made of ordinary words does not strip those words from the text", () => {
    const out = mineCustomerLanguageFromRows([row("brake pedal goes to the floor", { source: "leads", knownNames: ["The Tire Guy"] })]);
    expect(out.phrases[0]?.symptomTopic).toBe("brake_soft");
    expect(JSON.stringify(out)).not.toMatch(/\bguy\b/i);
  });
});

describe("extraction, merging and counting", () => {
  it("merges near-duplicate phrasings of one symptom and keeps the most common surface form", () => {
    const out = mineCustomerLanguageFromRows([
      row("my steering wheel shakes on the highway"),
      row("steering wheel shaking bad", { source: "calls" }),
      row("Steering wheel is vibrating", { source: "reviews" }),
      row("steering wheel shakes", { source: "leads" }),
    ]);
    expect(out.phrases).toHaveLength(1);
    expect(out.phrases[0]).toMatchObject({
      phrase: "steering wheel shakes",
      count: 4,
      symptomTopic: "steering_shake",
      sources: { sms: 1, calls: 1, reviews: 1, leads: 1 },
    });
    expect(out.sampled).toBe(4);
  });

  it("maps the braking-specific shake to brake_shake, not steering_shake", () => {
    const out = mineCustomerLanguageFromRows([row("it shakes when I brake hard")]);
    expect(out.phrases.map((p) => p.symptomTopic)).toEqual(["brake_shake"]);
  });

  it("counts conversations, not repeats — one caller saying it three times is one", () => {
    const out = mineCustomerLanguageFromRows([row("it's grinding. grinding every time. the grinding is loud", { source: "calls" })]);
    expect(out.phrases).toHaveLength(1);
    expect(out.phrases[0]).toMatchObject({ count: 1, symptomTopic: "grinding", sources: { calls: 1 } });
  });

  it("keeps distinct symptoms apart and ranks by count", () => {
    const out = mineCustomerLanguageFromRows([
      row("check engine light flashing"),
      row("check engine light came on"),
      row("check engine light on again"),
      row("my check engine light is on"),
    ]);
    expect(out.phrases[0]?.symptomTopic).toBe("check_engine_on");
    expect(out.phrases[0]?.count).toBe(3);
    expect(out.phrases[1]).toMatchObject({ symptomTopic: "check_engine_flashing", count: 1 });
  });

  it("lastSeenAt is the newest mention and blank rows are not sampled", () => {
    const out = mineCustomerLanguageFromRows([
      row("tire pressure light on", { at: "2026-09-01T12:00:00.000Z" }),
      row("", { at: "2026-09-30T12:00:00.000Z" }),
      row("tpms light came on", { at: new Date("2026-09-25T12:00:00.000Z") }),
    ]);
    expect(out.sampled).toBe(2);
    expect(out.phrases[0]?.lastSeenAt).toBe("2026-09-25T12:00:00.000Z");
  });

  it("text with no symptom vocabulary yields no phrases but is still sampled", () => {
    const out = mineCustomerLanguageFromRows([row("what time do you close on sunday")]);
    expect(out).toEqual({ phrases: [], sampled: 1, redactedTokens: 0 });
  });
});

describe("mineCustomerLanguage — a failed read is UNKNOWN, never an empty month", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  type Outcome = { rows?: unknown[]; throws?: Error };
  function fakeDb(outcomes: Outcome[]) {
    const queue = [...outcomes];
    const next = () => queue.shift() ?? { rows: [] };
    const terminal = () => {
      const o = next();
      if (o.throws) return Promise.reject(o.throws);
      return Promise.resolve(o.rows ?? []);
    };
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.limit = () => terminal();
    return { select: () => chain };
  }

  it("database unavailable → honest error, zero phrases, zero sampled", async () => {
    h.getDb.mockResolvedValueOnce(null);
    const out = await mineCustomerLanguage({ days: 30 });
    expect(out).toEqual({ phrases: [], sampled: 0, redactedTokens: 0, error: "database unavailable" });
  });

  it("every source throwing → error names all four, not an empty list", async () => {
    h.getDb.mockResolvedValueOnce(fakeDb(Array.from({ length: 4 }, () => ({ throws: new Error("ECONNRESET") }))));
    const out = await mineCustomerLanguage({ days: 30 });
    expect(out.error).toMatch(/all sources failed/);
    expect(out.error).toContain("ECONNRESET");
    expect(out.failedSources).toEqual(["calls", "sms", "reviews", "leads"]);
    expect(out.phrases).toEqual([]);
    expect(out.sampled).toBe(0);
  });

  it("one source failing is PARTIAL — phrases from the rest, the failure named", async () => {
    h.getDb.mockResolvedValueOnce(
      fakeDb([
        { throws: new Error("JSON_EXTRACT unsupported") }, // calls
        { rows: [{ body: "car won't start, just clicks", at: new Date("2026-09-28T10:00:00Z") }] }, // sms
        { rows: [] }, // reviews
        { rows: [] }, // leads
      ]),
    );
    const out = await mineCustomerLanguage({ days: 30, now: new Date("2026-10-01T12:00:00Z") });
    expect(out.error).toBeUndefined();
    expect(out.failedSources).toEqual(["calls"]);
    expect(out.sampled).toBe(1);
    expect(out.phrases[0]).toMatchObject({ symptomTopic: "wont_start", sources: { sms: 1 } });
  });

  it("call turns arrive as a JSON string or an array and the row's own name is stripped", async () => {
    h.getDb.mockResolvedValueOnce(
      fakeDb([
        {
          rows: [
            { turns: JSON.stringify(["this is Dana", "my steering wheel shakes at 65"]), name: "Dana Reyes", at: new Date("2026-09-29T10:00:00Z") },
            { turns: ["grinding when i stop"], name: null, at: new Date("2026-09-29T11:00:00Z") },
          ],
        },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      ]),
    );
    const out = await mineCustomerLanguage({ days: 30 });
    expect(JSON.stringify(out)).not.toMatch(/dana|reyes/i);
    expect(out.sampled).toBe(2);
    expect(out.phrases.map((p) => p.symptomTopic).sort()).toEqual(["grinding", "steering_shake"]);
    expect(out.redactedTokens).toBeGreaterThanOrEqual(1);
  });
});
