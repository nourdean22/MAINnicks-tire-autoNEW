/**
 * A seeded policy must name a rule that exists.
 *
 * THE DEFECT. `scripts/seed-policies.ts` carried
 * `autonomous-action.auto_score_applicant` with `approvalClass: "auto"` and
 * `tags: ["cost-bearing", …]`. There is no such rule. Verified three ways:
 *
 *   1. it is not among the 20 entries in RULES (lib/brain/autonomous-engine.ts)
 *   2. the trigger it named — `/api/webhooks/applicant` — was never built
 *      (app/api/webhooks/ holds inbound-crm, make, nickstire, stripe)
 *   3. autonomous-engine.ts:119-120 records the applicant rule as DELETED, with
 *      the entity moved to nickstire admin in v10.0.50
 *
 * Nothing could fire it, so it was never a live risk. It was a false entry in
 * the surface an operator reads to learn what is armed — which is the one place
 * that must not carry one.
 *
 * WHY THE EXISTING GATE MISSED IT, AND THIS IS THE INTERESTING PART.
 * `scripts/check-policy-coverage.ts` was widened on 2026-08-22 to check that
 * every rule HAS a policy — the "rule registered, no policy" deadlock, which
 * parks matches as pending forever. That is the direction that can hurt you at
 * runtime, so it was the direction that got built.
 *
 * The reverse — a policy naming NO rule — cannot deadlock anything, so nothing
 * looked for it, and a retired capability sat in the registry describing itself
 * as armed and cost-bearing. A gate that checks A→B does not check B→A, and the
 * unchecked direction is where stale claims accumulate precisely BECAUSE it is
 * the harmless one.
 *
 * This test reads the seed as TEXT rather than importing it: the script has
 * module-level side effects (argv parsing, a DB client) and importing it to
 * inspect an array would run all of that. It also needs no database, so unlike
 * the coverage gate — which fails OPEN when Prisma is unreachable — this one
 * gives the same answer on every machine.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { listRuleNames } from "@/lib/brain/autonomous-engine";

/** Pull every `autonomous-action.<name>` policy id out of the seed source. */
function seededActionRules(src: string): string[] {
  // Comments stripped so a tombstone naming a removed policy is not read as a
  // live seed entry — this file's own removal note does exactly that.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return [...code.matchAll(/"autonomous-action\.([a-z_0-9]+)"/g)].map((m) => m[1]);
}

describe("policy seed · every seeded action policy names a real rule", () => {
  it("POSITIVE CONTROL: it catches an orphan", () => {
    // Synthetic, owned by this test. `auto_score_applicant` is the real one that
    // shipped; a detector that matched nothing would make the sweep vacuous.
    const fake = 'id: "autonomous-action.auto_score_applicant",';
    expect(seededActionRules(fake)).toEqual(["auto_score_applicant"]);
    expect(listRuleNames().map((r) => r.name)).not.toContain("auto_score_applicant");
  });

  it("NEGATIVE CONTROL: a real rule, and a comment, are not orphans", () => {
    const real = 'id: "autonomous-action.auto_followup_expired_quote",';
    const [name] = seededActionRules(real);
    expect(listRuleNames().map((r) => r.name)).toContain(name);
    // A tombstone must not be read as a live entry, or removing a bad seed
    // correctly would leave this test permanently red.
    expect(seededActionRules('// removed: "autonomous-action.auto_score_applicant"')).toEqual([]);
    expect(seededActionRules('/* was "autonomous-action.gone_rule" */')).toEqual([]);
  });

  it("the RULES registry is non-empty — otherwise every check below is vacuous", () => {
    // Without this, a listRuleNames() that returned [] would make "no orphans"
    // impossible to satisfy and "every rule is known" trivially true.
    expect(listRuleNames().length).toBeGreaterThan(10);
  });

  it("no seeded autonomous-action policy is an orphan", () => {
    const src = readFileSync("scripts/seed-policies.ts", "utf8");
    const known = new Set(listRuleNames().map((r) => r.name));
    const seeded = seededActionRules(src);
    expect(seeded.length, "found no seeded action policies — the sweep had no subject").toBeGreaterThan(0);
    const orphans = seeded.filter((n) => !known.has(n));
    expect(
      orphans,
      "these policies name rules that do not exist in RULES. Either add the " +
        "rule or delete the seed entry — an entry here tells the operator the " +
        "capability is armed:\n  " + orphans.join("\n  "),
    ).toEqual([]);
  });
});
