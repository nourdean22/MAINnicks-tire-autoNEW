/**
 * Autopilot Wave 2 collectors — no-show bookings + overdue human-pending
 * conversations (2026-07-29).
 *
 * Pinned: source filters (only genuinely-open rows), truth labels (no-show
 * is `inferred` BY DESIGN — a preferred date is an intention, not an
 * appointment; a waiting text is `verified` + critical), no invented value,
 * and reconcilers close rows queue-side when the source resolves.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let capturedSql: string[] = [];
let bookingRows: Array<Record<string, unknown>> = [];
let jobRows: Array<Record<string, unknown>> = [];
let upserts: string[] = [];

vi.mock("./db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      const text = JSON.stringify(q);
      capturedSql.push(text);
      if (text.includes("FROM bookings")) return [bookingRows];
      if (text.includes("FROM sms_response_jobs")) return [jobRows];
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
  bookingRows = [];
  jobRows = [];
  upserts = [];
});

describe("collectNoShowBookings", () => {
  it("selects only open bookings with a parseable past preferred date (60d window)", async () => {
    const { collectNoShowBookings } = await import("./services/opportunityQueue");
    await collectNoShowBookings();
    const q = capturedSql.find((t) => t.includes("FROM bookings"));
    expect(q).toBeTruthy();
    expect(q).toContain("'new'");
    expect(q).toContain("'confirmed'");
    expect(q).toContain("STR_TO_DATE");
    expect(q).toContain("INTERVAL 60 DAY");
  });

  it("inserts an INFERRED, value-null, this_week row framed as closing the loop — never 'missed appointment'", async () => {
    bookingRows = [{
      id: 9,
      name: "Maya",
      phone: "2165550109",
      service: "Brake check",
      vehicle: "2018 Ford Escape",
      preferredDate: "2026-07-20",
      createdAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
    }];
    const { collectNoShowBookings } = await import("./services/opportunityQueue");
    const stats = await collectNoShowBookings();
    expect(stats.inserted).toBe(1);
    const insert = upserts[0];
    expect(insert).toContain("no_show_booking");
    expect(insert).toContain("inferred");
    expect(insert).toContain("this_week");
    // FCFS truth: no appointment language, no invented dollars
    expect(insert).not.toMatch(/missed appointment|appointment missed/i);
    expect(insert).toMatch(/never closed/);
  });
});

describe("collectOverdueHumanPending", () => {
  it("selects only human_pending rows past their SLA dueAt", async () => {
    const { collectOverdueHumanPending } = await import("./services/opportunityQueue");
    await collectOverdueHumanPending();
    const q = capturedSql.find((t) => t.includes("FROM sms_response_jobs"));
    expect(q).toBeTruthy();
    expect(q).toContain("human_pending");
    expect(q).toContain("dueAt < NOW()");
  });

  it("inserts a CRITICAL, verified row — a waiting customer outranks every marketing row", async () => {
    jobRows = [{
      id: 31,
      customerPhone: "2165550131",
      body: "is my car ready?",
      createdAt: new Date(Date.now() - 50 * 60_000).toISOString(),
      dueAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    }];
    const { collectOverdueHumanPending } = await import("./services/opportunityQueue");
    const stats = await collectOverdueHumanPending();
    expect(stats.inserted).toBe(1);
    const insert = upserts[0];
    expect(insert).toContain("human_pending_sms");
    expect(insert).toContain("critical");
    expect(insert).toContain("verified");
    expect(insert).toMatch(/is my car ready\?/);
  });
});

describe("wave-2 reconcilers", () => {
  it("close no-show rows when the booking resolves and human-pending rows when the job leaves human_pending", async () => {
    const { reconcileOpportunities } = await import("./services/opportunityQueue");
    await reconcileOpportunities();
    const all = capturedSql.join("\n");
    expect(all).toContain("no_show_booking");
    expect(all).toMatch(/b\.status NOT IN \('new', 'confirmed'\)/);
    expect(all).toContain("human_pending_sms");
    expect(all).toMatch(/j\.status != 'human_pending'/);
    // queue-side only — reconcilers never mutate source tables
    const mutatesSources = capturedSql.some((t) => /UPDATE\s+(bookings|sms_response_jobs|leads)\b/i.test(t.replace(/\\n/g, " ")));
    expect(mutatesSources).toBe(false);
  });
});
