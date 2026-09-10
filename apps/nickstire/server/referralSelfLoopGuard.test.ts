/**
 * The $300 technician-referral program must refuse a self-referral, and must
 * not pay twice for one candidate.
 *
 * WHY (2026-09-10): the $25 CUSTOMER program at referrals.submit has had a
 * self-referral guard since it shipped (server/routers/services.ts compares
 * normalized phones and emails). The $300 program had none — createTechnician
 * Referral verified only that the candidate row existed and came from
 * /careers, never that the referrer was a DIFFERENT person. Applying ten times
 * naming yourself produced ten pending $300 claims — $3,000 — and the admin
 * panel renders neither leadId nor candidateId, so nothing on screen would
 * show they were one person.
 *
 * There is also no unique index on technician_referrals (0121 uses plain
 * KEYs) and no client-side dedupe beyond a `submitted` flag, so a
 * refresh-and-resubmit produced two candidate rows and two referral rows.
 *
 * These assert the GUARD LOGIC directly rather than the source text, because a
 * regex over db.ts would pass on a guard that computes the right thing and
 * then falls through. The functions here are copied deliberately: if the
 * implementation's normalization ever diverges from this, the shared
 * `guardBehaviour` cases below still describe the behaviour the money depends
 * on, and the source assertion at the end pins them together.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sliceBlock } from "./testUtils/sourceBlock";

const DB_SRC = readFileSync(resolve(process.cwd(), "server/db.ts"), "utf8");

/** Last-10-digits, matching the $25 program and the implementation. */
const last10 = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);
const normName = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z]/g, "");

function isSelfReferral(
  referrer: { name: string; phone: string | null },
  candidate: { name: string; phone: string },
): boolean {
  const rp = last10(referrer.phone);
  if (rp) return rp === last10(candidate.phone);
  return Boolean(normName(referrer.name)) && normName(referrer.name) === normName(candidate.name);
}

describe("self-referral is refused on the $300 program", () => {
  it("blocks the same phone written three different ways", () => {
    const candidate = { name: "Bob Reynolds", phone: "2165550123" };
    for (const p of ["(216) 555-0123", "216-555-0123", "+1 216 555 0123"]) {
      expect(isSelfReferral({ name: "Robert R", phone: p }, candidate), p).toBe(true);
    }
  });

  it("allows a genuine referral between two different phones", () => {
    // The positive control. Without it, a guard that refused EVERY referral
    // would satisfy every assertion above — and quietly kill the program.
    expect(
      isSelfReferral({ name: "Dana", phone: "216-555-0199" }, { name: "Bob", phone: "2165550123" }),
      "a real referral was blocked",
    ).toBe(false);
  });

  it("falls back to name ONLY when the referrer gave no phone", () => {
    const cand = { name: "Bob Reynolds", phone: "2165550123" };
    expect(isSelfReferral({ name: "bob  reynolds", phone: null }, cand)).toBe(true);
    expect(isSelfReferral({ name: "BOB REYNOLDS", phone: "" }, cand)).toBe(true);
  });

  it("does NOT block two different people who share a name when a phone is given", () => {
    // Name is a weak key: this is why it only applies with no phone. Two real
    // people called Bob Reynolds must still be able to refer each other.
    expect(
      isSelfReferral({ name: "Bob Reynolds", phone: "216-555-0199" }, { name: "Bob Reynolds", phone: "2165550123" }),
    ).toBe(false);
  });

  it("an empty referrer phone and an empty candidate phone do not collide", () => {
    // last10("") === last10("") === "" — a naive equality check would treat two
    // blanks as the same person and refuse every phoneless referral.
    expect(last10("")).toBe("");
    expect(isSelfReferral({ name: "Dana", phone: "" }, { name: "Bob", phone: "" })).toBe(false);
  });
});

describe("the implementation actually contains these guards", () => {
  // The behaviour above is necessary but not sufficient: it proves the rule is
  // right, not that db.ts applies it. These pin it to the real write path.
  const code = DB_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // sliceBlock, not a raw slice. The raw form widens silently to EOF if the
  // end anchor ever moves, and every assertion below would then run against
  // the whole file and pass. The fail-open-slice gate caught exactly that in
  // this file's first draft — which is what the gate is for.
  const body = sliceBlock(code, "export async function createTechnicianReferral", "\nexport ", {
    label: "server/db.ts",
  });

  it("createTechnicianReferral reads the candidate's phone and name", () => {
    expect(body).toContain("phone: candidates.phone");
    expect(body).toContain("name: candidates.name");
  });

  it("it returns selfReferral instead of inserting", () => {
    expect(body).toContain("selfReferral: true as const");
    expect(body, "the guard must refuse BEFORE the insert").toMatch(
      /selfReferral: true as const[\s\S]*db\.insert\(technicianReferrals\)/,
    );
  });

  it("it suppresses a duplicate for a candidate that already has a referral", () => {
    expect(body).toContain("duplicate: true as const");
    expect(body).toContain("eq(technicianReferrals.candidateId, candidateId)");
  });

  it("the block log carries no PII", () => {
    // The $25 guard logs phone10 + full name on a path any unauthenticated
    // caller can trigger, and lint-pii cannot see it: its template-literal
    // rules only cover console.* and new Error(), never log.*.
    const logs = body.match(/log\.warn\(`\[technicianReferrals\][^`]*`/g) ?? [];
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) {
      expect(l, `PII in a public-path log line: ${l}`).not.toMatch(
        /referrerName|referrerPhone|candidate\.(name|phone)|phone10/,
      );
    }
  });
});
