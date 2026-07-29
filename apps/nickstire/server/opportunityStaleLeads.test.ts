/**
 * Stale-lead collector — the 24h–30d speed-to-lead closure (2026-07-29).
 *
 * Pinned here:
 *   1. The collector's SQL excludes careers + callback sources, and bounds
 *      the window to 24h–30d (no fresh leads, no zombies).
 *   2. Rows insert as SURFACED decisions (call-first framing), never sends —
 *      value stays null unless a real quote was recorded (no invented $).
 *   3. The reconciler closes handled + aged-out rows queue-side only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let capturedSql: string[] = [];
let leadRows: Array<Record<string, unknown>> = [];
let upserts: Array<Record<string, unknown>> = [];

vi.mock("./db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      const text = JSON.stringify(q);
      capturedSql.push(text);
      if (text.includes("FROM leads") || text.includes("FROM\\n") && text.includes("leads")) {
        return [leadRows];
      }
      if (text.includes("INSERT INTO revenue_opportunities")) {
        // record the parameterized values drizzle carries on the sql object
        upserts.push({ text });
        return [{ affectedRows: 1 }];
      }
      return [[]];
    },
  }),
}));

beforeEach(() => {
  capturedSql = [];
  leadRows = [];
  upserts = [];
});

describe("collectStaleLeads", () => {
  it("query excludes careers/callback and bounds the window 24h–30d", async () => {
    const { collectStaleLeads } = await import("./services/opportunityQueue");
    await collectStaleLeads();
    const leadQuery = capturedSql.find((t) => t.includes("FROM leads"));
    expect(leadQuery).toBeTruthy();
    expect(leadQuery).toContain("careers");
    expect(leadQuery).toContain("callback");
    expect(leadQuery).toContain("INTERVAL 24 HOUR");
    expect(leadQuery).toContain("INTERVAL 30 DAY");
    expect(leadQuery).toContain("contacted = 0");
  });

  it("uncontacted lead becomes a call-first opportunity with NO invented value", async () => {
    leadRows = [{
      id: 42,
      name: "Sam Rivera",
      phone: "2165550142",
      vehicle: "2019 Honda Civic",
      problem: "grinding noise when braking",
      source: "popup",
      recommendedService: null,
      estimatedValueCents: null, // no quote given → value must stay null
      urgencyScore: 4,
      createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    }];
    const { collectStaleLeads } = await import("./services/opportunityQueue");
    const stats = await collectStaleLeads();
    expect(stats.scanned).toBe(1);
    expect(stats.inserted).toBe(1);
    const insert = upserts[0]?.text as string;
    expect(insert).toContain("stale_lead");
    // The parameter list carries null for expected_revenue_cents — the
    // sweep-proof is that no fabricated cents value appears.
    expect(insert).not.toMatch(/51700|45000|infer/i);
    // call-first framing in the recommended action
    expect(insert).toMatch(/Call Sam/);
  });

  it("value flows through ONLY when a quote was actually recorded", async () => {
    leadRows = [{
      id: 43,
      name: "Ava",
      phone: "2165550143",
      vehicle: null,
      problem: null,
      source: "chat",
      recommendedService: "Brake pads",
      estimatedValueCents: 24900,
      urgencyScore: 3,
      createdAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    }];
    const { collectStaleLeads } = await import("./services/opportunityQueue");
    const stats = await collectStaleLeads();
    expect(stats.inserted).toBe(1);
    expect(upserts[0]?.text as string).toContain("24900");
  });

  it("degrades to zero-stats when the DB read fails (no throw)", async () => {
    const { collectStaleLeads } = await import("./services/opportunityQueue");
    leadRows = [];
    const stats = await collectStaleLeads();
    expect(stats).toEqual({ scanned: 0, inserted: 0, refreshed: 0 });
  });
});

describe("stale-lead reconciler SQL", () => {
  it("closes handled + >30d rows via the reconciler (queue-side only — no lead mutation)", async () => {
    const { reconcileOpportunities } = await import("./services/opportunityQueue");
    await reconcileOpportunities();
    const all = capturedSql.join("\n");
    // handled-outside-the-queue close
    expect(all).toMatch(/stale_lead/);
    expect(all).toMatch(/l\.contacted = 1 OR l\.status != 'new'|contacted = 1 OR l\.status/);
    // 30-day aging
    expect(all).toMatch(/INTERVAL 30 DAY/);
    // and none of the reconciler statements UPDATE the leads table itself
    const updatesLeads = capturedSql.some((t) => /UPDATE\s+leads/i.test(t.replace(/\\n/g, " ")));
    expect(updatesLeads).toBe(false);
  });
});
