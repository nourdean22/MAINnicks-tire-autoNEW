/**
 * The candidate follow-up clock: who writes candidates.nextFollowUpAt and who
 * reads it.
 *
 * WHY (2026-10-03 recruiting audit): drizzle/0129 added nextFollowUpAt for a
 * "not now" / talent-network technician, and nothing in the codebase wrote
 * or read it. A tech who said "keep me in mind" was recorded and forgotten.
 * This suite pins the behaviour that closes that gap:
 *  - the date is a function of the NEW status (scheduled, or cleared);
 *  - a person who is hired / started / accepted / declined / withdrew can
 *    never carry a follow-up, even when an admin passes a snooze;
 *  - the router hands the computed day count to the DB writer;
 *  - followUpsDue passes "unavailable" through instead of inventing an empty list.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const { updateCandidateStatus, getCandidateFollowUpsDue } = vi.hoisted(() => ({
  updateCandidateStatus: vi.fn(),
  getCandidateFollowUpsDue: vi.fn(),
}));
/**
 * Spread the REAL modules and replace only what this suite drives. A partial
 * hand-written ./db or ./lib/db-helper mock drops exports (getDb, requireDb)
 * that the adminProcedure chain imports, and serial vitest shares one mock
 * registry across files — the hazard apps/nickstire/AGENTS.md §3 records.
 * db-helper returns no DB, so the admin-security read is "no row yet"
 * (documented pass-through), not "read failed" (mutations refused).
 */
vi.mock("./lib/db-helper", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/db-helper")>();
  return { ...actual, db: () => Promise.resolve(null) };
});
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return { ...actual, updateCandidateStatus, getCandidateFollowUpsDue };
});
vi.mock("./services/auditTrail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/auditTrail")>();
  return { ...actual, logAdminAction: vi.fn(async () => undefined) };
});

import { candidatesRouter } from "./routers/candidates";
import type { TrpcContext } from "./_core/context";
import {
  CANDIDATE_FOLLOW_UP_DAYS,
  CANDIDATE_FOLLOW_UP_NEVER,
  CANDIDATE_STATUSES,
  followUpDaysFor,
} from "../shared/candidateLifecycle";

function caller() {
  return candidatesRouter.createCaller({
    user: { id: 1, openId: "admin", email: "a@b.com", name: "A", loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext);
}

beforeEach(() => {
  vi.clearAllMocks();
  updateCandidateStatus.mockResolvedValue({ success: true, followUpSaved: true });
});

describe("followUpDaysFor — the date is a function of status", () => {
  it("schedules the nurture statuses at their default distance", () => {
    expect(followUpDaysFor("talent_network")).toBe(60);
    expect(followUpDaysFor("not_now")).toBe(90);
    expect(followUpDaysFor("no_show")).toBe(2);
    expect(followUpDaysFor("contact_attempted")).toBe(1);
    expect(followUpDaysFor("offer")).toBe(2);
  });

  it("clears the date for an active conversation (no nudge needed)", () => {
    for (const s of ["new", "contacted", "conversation", "shop_tour", "interviewing", "skill_check"] as const) {
      expect(followUpDaysFor(s), s).toBeNull();
    }
  });

  it("never schedules a hired / started / accepted / declined / withdrawn person, even with a snooze", () => {
    for (const s of CANDIDATE_FOLLOW_UP_NEVER) {
      expect(followUpDaysFor(s), s).toBeNull();
      expect(followUpDaysFor(s, 30), `${s} + snooze`).toBeNull();
    }
  });

  it("an admin snooze wins for non-terminal statuses (positive control: the override is not ignored)", () => {
    expect(followUpDaysFor("not_now", 30)).toBe(30);
    expect(followUpDaysFor("conversation", 7)).toBe(7);
  });

  it("an out-of-range or fractional snooze falls back to the status default, not a guess", () => {
    expect(followUpDaysFor("talent_network", 0)).toBe(60);
    expect(followUpDaysFor("talent_network", 400)).toBe(60);
    expect(followUpDaysFor("talent_network", 1.5)).toBe(60);
    expect(followUpDaysFor("conversation", -3)).toBeNull();
  });

  it("every status is accounted for: scheduled, cleared, or never — no status silently missing", () => {
    const scheduled = new Set(Object.keys(CANDIDATE_FOLLOW_UP_DAYS));
    for (const s of CANDIDATE_STATUSES) {
      const d = followUpDaysFor(s);
      if (scheduled.has(s)) expect(d, s).toBeGreaterThan(0);
      else expect(d, s).toBeNull();
    }
    // No status is both scheduled and forbidden.
    for (const s of CANDIDATE_FOLLOW_UP_NEVER) expect(scheduled.has(s), s).toBe(false);
  });
});

describe("candidates.updateStatus writes the clock", () => {
  it("talent_network → the writer receives 60 days", async () => {
    const r = await caller().updateStatus({ id: 7, status: "talent_network" });
    expect(updateCandidateStatus).toHaveBeenCalledTimes(1);
    expect(updateCandidateStatus.mock.calls[0][0]).toBe(7);
    expect(updateCandidateStatus.mock.calls[0][1]).toMatchObject({ status: "talent_network", followUpInDays: 60 });
    expect(r).toMatchObject({ success: true, followUpInDays: 60, followUpSaved: true });
  });

  it("hired with a snooze still CLEARS the date (null, not undefined, so the column is written)", async () => {
    await caller().updateStatus({ id: 7, status: "hired", followUpInDays: 30 });
    expect(updateCandidateStatus.mock.calls[0][1].followUpInDays).toBeNull();
  });

  it("snooze on not_now passes the admin's 30, not the 90 default", async () => {
    await caller().updateStatus({ id: 9, status: "not_now", followUpInDays: 30 });
    expect(updateCandidateStatus.mock.calls[0][1].followUpInDays).toBe(30);
  });

  it("rejects a snooze outside 1..365 at the boundary instead of storing it", async () => {
    await expect(caller().updateStatus({ id: 9, status: "not_now", followUpInDays: 0 })).rejects.toThrow();
    await expect(caller().updateStatus({ id: 9, status: "not_now", followUpInDays: 366 })).rejects.toThrow();
    expect(updateCandidateStatus).not.toHaveBeenCalled();
  });

  it("reports when 0129 is missing and the date could not be saved", async () => {
    updateCandidateStatus.mockResolvedValue({ success: true, followUpSaved: false });
    const r = await caller().updateStatus({ id: 7, status: "not_now" });
    expect(r.followUpSaved).toBe(false);
  });
});

describe("candidates.followUpsDue reads the clock", () => {
  it("passes an unavailable read through as unavailable, never as an empty 'nobody due' list", async () => {
    getCandidateFollowUpsDue.mockResolvedValue({ available: false, reason: "migration_0129_pending", rows: [] });
    const r = await caller().followUpsDue();
    expect(r.available).toBe(false);
  });

  it("returns due rows as the reader gave them (positive control)", async () => {
    const rows = [{ id: 3, name: "T", phone: "2165550100", status: "talent_network", intent: "talent_network", positionTitle: null, daysOverdue: 2 }];
    getCandidateFollowUpsDue.mockResolvedValue({ available: true, reason: null, rows });
    const r = await caller().followUpsDue();
    expect(r).toEqual({ available: true, reason: null, rows });
  });
});

describe("db.ts: writer and reader share the database clock", () => {
  const DB_SRC = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
  const writer = DB_SRC.slice(
    DB_SRC.indexOf("export async function updateCandidateStatus"),
    DB_SRC.indexOf("export async function getCandidateFollowUpsDue"),
  );
  const reader = DB_SRC.slice(
    DB_SRC.indexOf("export async function getCandidateFollowUpsDue"),
    DB_SRC.indexOf("// ─── MECHANIC Q&A QUERIES"),
  );

  it("schedules with DATE_ADD(NOW(), …) rather than a JS Date (the driver shifts JS Dates +4h)", () => {
    expect(writer).toMatch(/DATE_ADD\(NOW\(\), INTERVAL/);
    expect(writer).not.toMatch(/nextFollowUpAt:\s*new Date/);
  });

  it("the reader compares against NOW() and excludes the never-follow-up statuses and honeypot rows", () => {
    expect(reader).toMatch(/<= NOW\(\)/);
    expect(reader).toMatch(/notInArray\(candidates\.status, \[\.\.\.CANDIDATE_FOLLOW_UP_NEVER\]\)/);
    expect(reader).toMatch(/ne\(candidates\.source, CANDIDATE_SOURCE_HONEYPOT\)/);
  });

  it("a missing 0129 column is reported, not swallowed into an empty list", () => {
    expect(reader).toMatch(/migration_0129_pending/);
  });
});
