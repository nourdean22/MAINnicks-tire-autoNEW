/**
 * Campaign-eligibility predicate parity (Autopilot Wave 5, 2026-07-29).
 *
 * The defect this closes: campaignEligiblePhoneSql checked ONLY
 * customers.smsOptOut while sendSms's fail-closed index unions THREE
 * sources — so a lead/VAPI caller who texted STOP still counted as
 * campaign "eligible" (each send was refused at send time, but batch
 * counts overstated reach and burned capped-batch slots).
 *
 * Pins:
 *   1. The predicate carries all three sources (customers flag,
 *      sms_preferences.opted_out, inbound-STOP message log).
 *   2. The STOP-keyword list is IDENTICAL to sms.ts's SQL source — the
 *      one-of-two-forms trap ("STOP ALL" vs "STOPALL") is exactly how
 *      these lists drift.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { campaignEligiblePhoneSql } from "./lib/sms-eligibility";

function extractKeywordList(source: string): string[] {
  // Every SQL-side keyword list is written as IN ('A','B',...) — capture the
  // first list that contains STOPALL (the opt-out list, not enum defs).
  const lists = [...source.matchAll(/IN \(([^)]+)\)/g)].map((m) => m[1]);
  const optOutList = lists.find((l) => l.includes("STOPALL"));
  if (!optOutList) return [];
  return [...optOutList.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

/** Drizzle SQL objects are circular (params reference tables) — collect every
 *  string fragment cycle-safely instead of JSON.stringify. */
function sqlText(v: unknown): string {
  const parts: string[] = [];
  const seen = new Set<object>();
  const walk = (x: unknown): void => {
    if (typeof x === "string") { parts.push(x); return; }
    if (!x || typeof x !== "object" || seen.has(x)) return;
    seen.add(x);
    for (const inner of Object.values(x as Record<string, unknown>)) walk(inner);
  };
  walk(v);
  return parts.join(" ");
}

describe("campaignEligiblePhoneSql — three-source parity", () => {
  const serialized = sqlText(campaignEligiblePhoneSql);

  it("checks the customers flag", () => {
    expect(serialized).toContain("smsOptOut");
  });

  it("excludes durable sms_preferences opt-outs (leads/VAPI callers with no customer row)", () => {
    expect(serialized).toContain("sms_preferences");
    expect(serialized).toContain("opted_out = 1");
  });

  it("excludes phones whose inbound message log carries a STOP keyword", () => {
    expect(serialized).toContain("sms_messages");
    expect(serialized).toContain("direction = 'inbound'");
    expect(serialized).toContain("STOPALL");
  });

  it("keyword list is IDENTICAL to sms.ts's SQL opt-out source (drift tripwire)", () => {
    const smsSource = readFileSync(join(process.cwd(), "server", "sms.ts"), "utf8");
    const eligibilitySource = readFileSync(join(process.cwd(), "server", "lib", "sms-eligibility.ts"), "utf8");
    const canonical = extractKeywordList(smsSource);
    const predicate = extractKeywordList(eligibilitySource);
    expect(canonical.length).toBeGreaterThan(5);
    expect(predicate).toEqual(canonical);
  });

  it("phone identity is last-10 normalized on BOTH sides of each join (mixed-format storage)", () => {
    // 2026-08-09 · this assertion used to be `count >= 3`, which does NOT check
    // what its own name claims. The predicate had 2 normalizations on the
    // sms_preferences leg and 1 on the STOP-log leg — total 3, so it passed
    // while one join compared a RAW column against a normalized one. Counting
    // occurrences can never prove symmetry; count the COMPARISONS instead.
    //
    // Every `=` that joins a phone to a phone must have a normalized wrapper on
    // BOTH sides. There are two such comparisons (sms_preferences, sms_messages)
    // plus the customers-flag check, which is not a phone join.
    const normalizations = serialized.match(/RIGHT\(REPLACE/g)?.length ?? 0;
    expect(
      normalizations,
      "each of the 2 phone joins needs a normalizer on BOTH sides = 4 total; " +
        "fewer means one side is raw and a mixed-format or legacy row escapes suppression",
    ).toBeGreaterThanOrEqual(4);
  });

  it("no phone join compares a BARE sc.phone / sp.phone against a normalized column", () => {
    // The specific shape the count-based assertion above was blind to.
    // A raw `sc.phone =` or `sp.phone =` on either side of a comparison means
    // suppression depends on every historical writer having normalized first.
    expect(serialized).not.toMatch(/(?<!RIGHT\(REPLACE\([^)]*)\bsc\.phone\s*=/);
    expect(serialized).not.toMatch(/(?<!RIGHT\(REPLACE\([^)]*)\bsp\.phone\s*=/);
  });
});
