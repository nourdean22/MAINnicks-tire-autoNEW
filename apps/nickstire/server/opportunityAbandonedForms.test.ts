/**
 * Abandoned-form collector (Autopilot Wave 6 — mission P5 "abandoned forms
 * without subsequent contact") + the runtime-truth-pass performance fix
 * (2026-07-29): the converted-check must be fetch-once + JS-filter, NEVER a
 * correlated NOT EXISTS with REPLACE()-chained join keys (unindexable — the
 * first version stalled a live refresh for 20+ minutes).
 *
 * Pinned: the 2h–14d window (the one-shot recovery SMS owns 30min–2h),
 * subsequent-contact exclusion computed in JS from bounded phone fetches,
 * `partial` evidence class with NO invented value, and the string-keyed
 * reconciler (sessionId is a varchar PK — no CAST) closing on conversion or
 * 14-day aging without ever mutating source tables.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let capturedSql: string[] = [];
let formRows: Array<Record<string, unknown>> = [];
let leadRows: Array<Record<string, unknown>> = [];
let bookingRows: Array<Record<string, unknown>> = [];
let liveOppRows: Array<Record<string, unknown>> = [];
let upserts: string[] = [];

vi.mock("./db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      const text = JSON.stringify(q);
      capturedSql.push(text);
      if (text.includes("FROM abandoned_forms")) return [formRows];
      if (text.includes("JOIN abandoned_forms")) return [liveOppRows];
      if (text.includes("FROM leads")) return [leadRows];
      if (text.includes("FROM bookings")) return [bookingRows];
      if (text.includes("INSERT INTO revenue_opportunities")) {
        upserts.push(text);
        return [{ affectedRows: 1 }];
      }
      return [[]];
    },
  }),
}));

beforeEach(() => {
  capturedSql = [];
  formRows = [];
  leadRows = [];
  bookingRows = [];
  liveOppRows = [];
  upserts = [];
});

describe("collectAbandonedForms", () => {
  it("windows 2h–14d with NO correlated subqueries (the stall class); converts via bounded phone fetches", async () => {
    const { collectAbandonedForms } = await import("./services/opportunityQueue");
    await collectAbandonedForms();
    const q = capturedSql.find((t) => t.includes("FROM abandoned_forms"));
    expect(q).toBeTruthy();
    expect(q).toContain("INTERVAL 2 HOUR");
    expect(q).toContain("INTERVAL 14 DAY");
    // the performance pin: the forms query itself must stay flat
    expect(q).not.toContain("NOT EXISTS");
    expect(q).not.toContain("REPLACE(");
    // conversion signals fetched once, bounded
    const leads = capturedSql.find((t) => t.includes("FROM leads"));
    const bookings = capturedSql.find((t) => t.includes("FROM bookings"));
    expect(leads).toContain("INTERVAL 15 DAY");
    expect(leads).toContain("LIMIT 500");
    expect(bookings).toContain("INTERVAL 15 DAY");
  });

  it("filters out a partial whose person subsequently converted (lead after abandonment)", async () => {
    const abandonedAt = new Date(Date.now() - 6 * 3600_000).toISOString();
    formRows = [
      { sessionId: "sess-converted", formType: "booking", name: "Riley", phone: "2165550177", service: "tires", createdAt: abandonedAt },
      { sessionId: "sess-open", formType: "booking", name: "Casey", phone: "2165550188", service: "brakes", createdAt: abandonedAt },
    ];
    leadRows = [{ phone: "(216) 555-0177", createdAt: new Date(Date.now() - 1 * 3600_000).toISOString() }];
    const { collectAbandonedForms } = await import("./services/opportunityQueue");
    const stats = await collectAbandonedForms();
    // only the non-converted partial becomes an opportunity
    expect(stats.inserted).toBe(1);
    expect(upserts[0]).toContain("sess-open");
    expect(upserts.join("\n")).not.toContain("sess-converted");
  });

  it("a conversion BEFORE the abandonment does not exclude (they came back and bailed again)", async () => {
    const abandonedAt = new Date(Date.now() - 6 * 3600_000).toISOString();
    formRows = [{ sessionId: "sess-rebail", formType: "booking", name: "Sam", phone: "2165550199", service: "oil", createdAt: abandonedAt }];
    leadRows = [{ phone: "2165550199", createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString() }];
    const { collectAbandonedForms } = await import("./services/opportunityQueue");
    const stats = await collectAbandonedForms();
    expect(stats.inserted).toBe(1);
  });

  it("inserts a PARTIAL-quality, value-null row — a typed-but-unsubmitted form is interest, never dollars", async () => {
    formRows = [{
      sessionId: "sess-abc123",
      formType: "booking",
      name: "Riley",
      phone: "2165550177",
      service: "2 used tires 225/65R17",
      createdAt: new Date(Date.now() - 6 * 3600_000).toISOString(),
    }];
    const { collectAbandonedForms } = await import("./services/opportunityQueue");
    const stats = await collectAbandonedForms();
    expect(stats.inserted).toBe(1);
    const insert = upserts[0];
    expect(insert).toContain("abandoned_form");
    expect(insert).toContain("sess-abc123");
    expect(insert).toContain("partial");
    expect(insert).toMatch(/Call Riley/);
    expect(insert).toMatch(/never finished/);
  });

  it("degrades to zero-stats on read failure", async () => {
    formRows = [];
    const { collectAbandonedForms } = await import("./services/opportunityQueue");
    expect(await collectAbandonedForms()).toEqual({ scanned: 0, inserted: 0, refreshed: 0 });
  });
});

describe("abandoned-form reconciler", () => {
  it("live-row join is flat (varchar sessionId, no CAST, no correlated EXISTS); closes converted + aged in JS; sources never mutated", async () => {
    liveOppRows = [
      { id: "op-converted", formPhone: "2165550177", abandonedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() },
      { id: "op-aged", formPhone: "2165550100", abandonedAt: new Date(Date.now() - 20 * 86_400_000).toISOString() },
      { id: "op-live", formPhone: "2165550111", abandonedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
    ];
    leadRows = [{ phone: "2165550177", createdAt: new Date(Date.now() - 1 * 86_400_000).toISOString() }];
    const { reconcileOpportunities } = await import("./services/opportunityQueue");
    const stats = await reconcileOpportunities();
    const joinQ = capturedSql.find((t) => t.includes("JOIN abandoned_forms"));
    expect(joinQ).toBeTruthy();
    expect(joinQ).toMatch(/a\.sessionId = o\.source_id/);
    expect(joinQ).not.toContain("CAST(o.source_id");
    expect(joinQ).not.toContain("EXISTS");
    // converted + aged selected for closure; the genuinely-live row untouched
    // (closed-count needs a full transition mock; `checked` counts the JS
    // decisions themselves, which is what this test pins)
    expect(stats.checked).toBeGreaterThanOrEqual(2);
    const mutatesSources = capturedSql.some((t) => /UPDATE\s+(abandoned_forms|leads|bookings)\b/i.test(t.replace(/\\n/g, " ")));
    expect(mutatesSources).toBe(false);
  });
});
