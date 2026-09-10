/**
 * A referral's payout state can only move forwards, and only once.
 *
 * WHY (2026-09-10). markHired read NOTHING before writing — no row fetch, no
 * status precondition. The only guard was the admin panel rendering its
 * buttons by status, which is a guard against a cooperative user, not against
 * a stale tab, a double-click, or a direct mutation call. Any `leads.manage`
 * holder — a tier that includes front_desk — could move a PAID referral back
 * to `eligible` with a FRESH 90-day clock while paidAt stayed set. That is a
 * second $300 on one referral, and the audit row could not show who did it
 * because these actions do not pass an actor.
 *
 * markPaid did check status, but as a READ-then-write: two concurrent clicks
 * both observe "eligible" and both proceed. disqualify checked nothing at all,
 * so a paid referral could be flipped to disqualified — misstating what
 * happened rather than undoing it.
 *
 * The fix is a conditional update: the expected status goes into the WHERE, so
 * exactly one of two racing callers matches a row. These tests assert the
 * TRANSITION TABLE that encodes, plus the wiring that applies it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sliceBlock } from "./testUtils/sourceBlock";

const APP = process.cwd();
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ROUTER = strip(readFileSync(resolve(APP, "server/routers/technicianReferrals.ts"), "utf8"));
const DB = strip(readFileSync(resolve(APP, "server/db.ts"), "utf8"));

type Status = "pending" | "eligible" | "paid" | "disqualified" | "forfeited";

/** The transition table the guards encode. */
const ALLOWED: Record<"markHired" | "markPaid" | "disqualify", Status[]> = {
  markHired: ["pending"],
  markPaid: ["eligible"],
  disqualify: ["pending", "eligible"],
};

const permits = (action: keyof typeof ALLOWED, from: Status) => ALLOWED[action].includes(from);

describe("the transition table refuses every way to pay twice", () => {
  it("a PAID referral cannot be re-hired — the second-$300 path", () => {
    // The exact defect: re-hiring restarts the 90-day clock on a referral
    // whose money is already out, and paidAt is never cleared.
    expect(permits("markHired", "paid")).toBe(false);
  });

  it("a PAID referral cannot be paid again", () => {
    expect(permits("markPaid", "paid")).toBe(false);
  });

  it("a PAID referral cannot be disqualified", () => {
    // Reversing a payout is an accounting action. Flipping the status
    // misstates history instead of undoing it.
    expect(permits("disqualify", "paid")).toBe(false);
  });

  it("a DISQUALIFIED referral cannot re-enter the payout path", () => {
    expect(permits("markHired", "disqualified")).toBe(false);
    expect(permits("markPaid", "disqualified")).toBe(false);
  });

  it("a PENDING referral cannot skip straight to paid", () => {
    // 90 days is stamped by markHired. Paying from pending would pay with no
    // eligibleAt ever computed.
    expect(permits("markPaid", "pending")).toBe(false);
  });

  it("the legitimate path still works — the positive control", () => {
    // Without this, a table that refused EVERY transition would satisfy every
    // assertion above and silently kill the program.
    expect(permits("markHired", "pending")).toBe(true);
    expect(permits("markPaid", "eligible")).toBe(true);
    expect(permits("disqualify", "pending")).toBe(true);
    expect(permits("disqualify", "eligible")).toBe(true);
  });
});

describe("the guards are actually wired to the write path", () => {
  // The table above is the rule; these assert the code applies it. A correct
  // rule the implementation ignores is the failure mode being guarded.
  const fn = (marker: string, end: string) => sliceBlock(ROUTER, marker, end, { label: "technicianReferrals.ts" });

  it("markHired passes expectStatus pending and throws on no match", () => {
    const block = fn("markHired: adminProcedure", "markPaid: adminProcedure");
    expect(block).toMatch(/expectStatus:\s*\["pending"\]/);
    expect(block, "a no-op write must not report success").toContain("CONFLICT");
  });

  it("markPaid passes expectStatus eligible and throws on no match", () => {
    const block = fn("markPaid: adminProcedure", "disqualify: adminProcedure");
    expect(block).toMatch(/expectStatus:\s*\["eligible"\]/);
    expect(block).toContain("CONFLICT");
  });

  it("disqualify excludes paid", () => {
    const block = sliceBlock(ROUTER, "disqualify: adminProcedure", "\n});", {
      label: "technicianReferrals.ts",
    });
    expect(block).toMatch(/expectStatus:\s*\["pending",\s*"eligible"\]/);
    expect(block).toContain("CONFLICT");
  });

  it("the update helper reports whether a row actually matched", () => {
    // It previously discarded affectedRows and returned { success: true }
    // unconditionally, so an update against a nonexistent id toasted
    // "Updated." while the database was untouched.
    const helper = sliceBlock(DB, "export async function updateTechnicianReferralStatus", "\nexport ", {
      label: "db.ts",
    });
    expect(helper).toContain("affectedRows");
    expect(helper).toMatch(/success:\s*matched\s*>\s*0/);
    expect(helper, "the status must be part of the WHERE, not a prior read").toContain(
      "inArray(technicianReferrals.status",
    );
  });
});
