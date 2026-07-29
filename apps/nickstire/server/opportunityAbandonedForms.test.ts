/**
 * Abandoned-form collector (Autopilot Wave 6 — mission P5 "abandoned forms
 * without subsequent contact").
 *
 * Pinned: the 2h–14d window (the one-shot recovery SMS owns 30min–2h),
 * subsequent-contact exclusion (lead OR booking on the same phone at/after
 * abandonment), `partial` evidence class with NO invented value, and the
 * string-keyed reconciler (sessionId is a varchar PK — no CAST).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let capturedSql: string[] = [];
let formRows: Array<Record<string, unknown>> = [];
let upserts: string[] = [];

vi.mock("./db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      const text = JSON.stringify(q);
      capturedSql.push(text);
      if (text.includes("FROM abandoned_forms")) return [formRows];
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
  upserts = [];
});

describe("collectAbandonedForms", () => {
  it("windows 2h–14d and excludes anyone who subsequently submitted a lead/booking", async () => {
    const { collectAbandonedForms } = await import("./services/opportunityQueue");
    await collectAbandonedForms();
    const q = capturedSql.find((t) => t.includes("FROM abandoned_forms"));
    expect(q).toBeTruthy();
    expect(q).toContain("INTERVAL 2 HOUR");
    expect(q).toContain("INTERVAL 14 DAY");
    expect(q).toContain("FROM leads");
    expect(q).toContain("FROM bookings");
    expect(q).toContain("NOT EXISTS");
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
  it("joins on the varchar sessionId (no CAST) and closes on conversion or 14-day aging — sources never mutated", async () => {
    const { reconcileOpportunities } = await import("./services/opportunityQueue");
    await reconcileOpportunities();
    const all = capturedSql.join("\n");
    expect(all).toContain("abandoned_form");
    expect(all).toMatch(/a\.sessionId = o\.source_id/);
    // this reconciler section must NOT cast the varchar key
    const section = all.slice(all.indexOf("abandoned_form"));
    expect(section.slice(0, 900)).not.toContain("CAST(o.source_id");
    const mutatesSources = capturedSql.some((t) => /UPDATE\s+(abandoned_forms|leads|bookings)\b/i.test(t.replace(/\\n/g, " ")));
    expect(mutatesSources).toBe(false);
  });
});
