/**
 * Canaries for the derived AutomationPolicy baselines.
 *
 * Per AGENTS.md > "Ship the canary, not just the control": the derivation IS a
 * control — it is what makes `check:policy-coverage` satisfiable and what keeps the
 * fail-closed engine from parking a lane forever with nobody able to see it.
 *
 * The second test is the one that matters. Deriving `approvalClass` from
 * `rule.approval` would arm 17 lanes to fire unattended — 15 send_telegram, and
 * `auto_followup_expired_quote` sends EMAIL TO A LEAD. That would turn "close a
 * coverage gap" into a customer-facing change with no operator decision anywhere in
 * the loop. It is a one-word edit away at all times, so it gets an assertion.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { listRuleNames } from "@/lib/brain/autonomous-engine";
import {
  DERIVED_BASELINE_APPROVAL,
  derivedRulePolicies,
  mergeById,
} from "@/lib/automation/derive-rule-policies";

describe("derived rule policies", () => {
  it("covers every rule the engine dispatches — the list cannot be incomplete", () => {
    const rules = listRuleNames().map((r) => r.name).sort();
    const derived = derivedRulePolicies().map((p) => p.name).sort();
    expect(rules.length).toBeGreaterThanOrEqual(20);
    expect(derived).toEqual(rules);
    for (const p of derivedRulePolicies()) {
      expect(p.id).toBe(`autonomous-action.${p.name}`);
      expect(p.surface).toBe("autonomous-action");
    }
  });

  it("NEVER derives approvalClass 'auto' — creating a policy must not arm a lane", () => {
    expect(DERIVED_BASELINE_APPROVAL).toBe("pending");
    const armed = derivedRulePolicies().filter((p) => p.approvalClass !== "pending");
    expect(
      armed.map((p) => p.id),
      "a derived baseline is fail-closed by construction. If this fails, seeding would " +
        "arm these lanes to fire unattended — including one that emails customers.",
    ).toEqual([]);
  });

  it("marks every baseline as needing curation, so an UNSPECIFIED metric is never mistaken for a real one", () => {
    for (const p of derivedRulePolicies()) {
      expect(p.tags).toContain("derived-baseline");
      expect(p.tags).toContain("needs-curation");
      expect(p.successMetric).toMatch(/UNSPECIFIED/);
    }
  });

  it("mergeById lets a curated entry override a derived baseline, not the reverse", () => {
    const derived = derivedRulePolicies();
    const target = derived[0];
    const curated = { ...target, objective: "CURATED", approvalClass: "auto" as const };
    // Curated LAST, exactly as the seed script orders them.
    const merged = mergeById([...derived, curated]);
    const hit = merged.find((p) => p.id === target.id);
    expect(hit?.objective).toBe("CURATED");
    expect(hit?.approvalClass).toBe("auto");
    expect(merged.filter((p) => p.id === target.id)).toHaveLength(1);
  });

  // Completeness runs one way (every rule has a policy). The INVERSE — every curated
  // autonomous-action id names a real rule — was unasserted, and there is already one
  // violation. `auto_score_applicant` exists as a live `auto` policy for an automation
  // that does not exist: no entry in RULES, and its declared trigger
  // /api/webhooks/applicant is not a route. It is allowlisted here rather than deleted
  // because removing it is a production write, not a code change.
  //
  // Why this matters beyond tidiness: if someone later implements a rule by that name,
  // the curated `auto` entry is spread last and wins over the pending baseline, AND
  // upsertPolicy's `update` block preserves approvalClass on re-seed. The rule would be
  // born armed with no operator decision anywhere in the loop.
  const KNOWN_ORPHAN_POLICY_IDS = new Set(["autonomous-action.auto_score_applicant"]);

  it("no NEW curated autonomous-action policy names a rule that does not exist", () => {
    const src = readFileSync(resolve(process.cwd(), "scripts/seed-policies.ts"), "utf8");
    const curatedIds = [...src.matchAll(/id:\s*"(autonomous-action\.[a-z0-9_]+)"/g)].map((m) => m[1]);
    expect(curatedIds.length).toBeGreaterThan(0);
    const realIds = new Set(listRuleNames().map((r) => `autonomous-action.${r.name}`));
    const orphans = curatedIds.filter((id) => !realIds.has(id) && !KNOWN_ORPHAN_POLICY_IDS.has(id));
    expect(
      orphans,
      "a curated policy for a rule that does not exist can be born ARMED if the rule is " +
        "later implemented — curation wins over the pending baseline and re-seed preserves it.",
    ).toEqual([]);
  });

  // scripts/ is excluded from tsconfig.typecheck.json and eslint has no
  // import/no-unresolved, so nothing else would catch the gate's import breaking.
  // This file imports the same specifier the script does, so a rename fails here.
  it("the coverage gate cannot exit 0 on its own crash", () => {
    const src = readFileSync(resolve(process.cwd(), "scripts/check-policy-coverage.ts"), "utf8");
    const tail = src.slice(src.indexOf("main().catch"));
    expect(tail, "main().catch must exit non-zero — it previously logged and returned, so " +
      "a broken import printed 'crashed: Cannot find module' and verify:hard still passed",
    ).toContain("process.exit(1)");
    expect(src).toContain('from "@/lib/brain/autonomous-engine"');
  });

  // The derivation is complete by construction, but only if the seed script still
  // CALLS it. Deleting that one line would silently restore the hand-kept list —
  // the original defect — with every test above still green. Assert the wiring.
  it("the seed script actually uses the derivation and orders curation last", () => {
    const src = readFileSync(
      resolve(process.cwd(), "scripts/seed-policies.ts"),
      "utf8",
    );
    expect(src).toContain("derivedRulePolicies()");
    expect(src).toContain("mergeById(");
    const derivedAt = src.indexOf("...derivedRulePolicies()");
    const curatedAt = src.indexOf("...CURATED_NON_CRON");
    expect(derivedAt).toBeGreaterThan(-1);
    expect(curatedAt).toBeGreaterThan(-1);
    expect(
      curatedAt,
      "CURATED_NON_CRON must be spread AFTER the derived baselines or curation loses",
    ).toBeGreaterThan(derivedAt);
  });
});
