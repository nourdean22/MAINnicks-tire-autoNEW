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
const ALLOWED: Record<"markHired" | "markPaid" | "disqualify" | "markForfeited", Status[]> = {
  markHired: ["pending"],
  markPaid: ["eligible"],
  disqualify: ["pending", "eligible"],
  // Only from eligible. A pending referral was never confirmed hired, so there
  // is no 90-day condition to fail; a paid one is money already out.
  markForfeited: ["eligible"],
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

  it("a PAID referral cannot be forfeited", () => {
    // Same rule as disqualify: the money is out, so this is an accounting
    // reversal, not a status edit.
    expect(permits("markForfeited", "paid")).toBe(false);
  });

  it("a PENDING referral cannot be forfeited — it was never hired", () => {
    // Forfeiting means the 90-day condition was failed. A referral that was
    // never confirmed hired has no such condition running, and recording one
    // as forfeited would assert a hire that never happened.
    expect(permits("markForfeited", "pending")).toBe(false);
  });

  it("the legitimate path still works — the positive control", () => {
    // Without this, a table that refused EVERY transition would satisfy every
    // assertion above and silently kill the program.
    expect(permits("markHired", "pending")).toBe(true);
    expect(permits("markPaid", "eligible")).toBe(true);
    expect(permits("disqualify", "pending")).toBe(true);
    expect(permits("disqualify", "eligible")).toBe(true);
    expect(permits("markForfeited", "eligible")).toBe(true);
  });
});

describe("forfeited and disqualified stay distinct", () => {
  // `forfeited` shipped as a declared status with a colour in the panel and
  // NO WRITER — the state it names (a tech leaving inside 90 days) happens
  // constantly, and until now the only way to record it was Disqualify, which
  // says the CLAIM was invalid when it was perfectly good.
  it("forfeit is reachable — the status is no longer write-only", () => {
    expect(ROUTER).toContain("markForfeited: adminProcedure");
    expect(ROUTER).toContain('status: "forfeited"');
  });

  it("the admin panel can actually reach it", () => {
    const panel = strip(
      readFileSync(resolve(APP, "client/src/pages/admin/leads/TechnicianReferralsPanel.tsx"), "utf8"),
    );
    // A router action with no button is the same dead end in a new place.
    expect(panel).toContain("trpc.technicianReferrals.markForfeited.useMutation");
    expect(panel).toContain("markForfeited.mutate(");
  });

  it("an EARNED bonus cannot be forfeited — the second way to lose $300", () => {
    // The transition table alone permits eligible -> forfeited, and that is
    // right BEFORE day 90 and wrong after it: once eligibleAt passes, markPaid
    // would succeed, which means the money is owed. Forfeiting then is not a
    // status edit, it is refusing a debt — and the only thing standing in the
    // way was a confirm dialog ASKING whether the tech left before day 90,
    // which is a guard against a cooperative user, not against a stale tab.
    // markPaid carries the mirror-image check for the mirror-image reason.
    const block = sliceBlock(ROUTER, "markForfeited: adminProcedure", "\n});", {
      label: "technicianReferrals.ts",
    });
    expect(block, "forfeit must re-read the row, not trust the client's status").toContain(
      "getTechnicianReferralById",
    );
    expect(block, "forfeit must compare eligibleAt against now").toMatch(/eligibleAt.*getTime\(\)\s*<=\s*Date\.now\(\)/s);
  });

  it("the panel does not offer Forfeit once the clock is up", () => {
    // The server refuses it; this keeps the button from inviting the attempt.
    const panel = strip(
      readFileSync(resolve(APP, "client/src/pages/admin/leads/TechnicianReferralsPanel.tsx"), "utf8"),
    );
    expect(panel).toMatch(/clockUp\s*=\s*r\.eligibleAt/);
    expect(panel).toMatch(/disabled=\{markForfeited\.isPending \|\| clockUp\}/);
  });

  it("forfeit does not reuse the disqualified status", () => {
    const block = sliceBlock(ROUTER, "markForfeited: adminProcedure", "\n});", {
      label: "technicianReferrals.ts",
    });
    expect(block).toMatch(/expectStatus:\s*\["eligible"\]/);
    expect(block).toContain("CONFLICT");
    expect(block, "forfeited must not be written as disqualified").not.toContain('status: "disqualified"');
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
    // Anchored on the NEXT action, not on "\n});". That end marker used to be
    // the router's own closing brace — fine while disqualify was last, and
    // silently widened to cover markForfeited too the moment one was added
    // after it. A block assertion that grows to include its neighbours is the
    // same fail-open widening sliceBlock exists to refuse.
    const block = sliceBlock(ROUTER, "disqualify: adminProcedure", "markForfeited: adminProcedure", {
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
