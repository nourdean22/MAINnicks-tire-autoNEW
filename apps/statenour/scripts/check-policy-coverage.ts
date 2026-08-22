/**
 * Pre-push gate [10/10] · v10.0.148 · May 03
 *
 * Verifies every active/folded cron in config/crons.ts has a matching
 * AutomationPolicy row in the registry. Fails the push if any are
 * missing — this is the rule that stops new automations from slipping
 * in unaudited.
 *
 * Soft mode (default for v10.0.148 ship): warns but doesn't fail. The
 * gate ratchets to HARD mode in v10.0.149+ once seed is verified
 * stable in production. Override either way:
 *   POLICY_GATE_HARD=1   → fail-close even on v10.0.148
 *   POLICY_GATE_SOFT=1   → demote to warn even after ratchet
 *
 * Note this script ONLY checks crons. Tools / slash / autonomous
 * actions / webhooks aren't enumerable from a single source-of-truth
 * file the way config/crons.ts gives crons, so they're checked by the
 * `findMissingPolicies` helper called from feature-specific tests
 * (e.g. tool.send-email-via-resend has its own integration test that
 * asserts the policy exists).
 *
 * Usage:
 *   set -a && . ./.env.local && set +a
 *   pnpm tsx scripts/check-policy-coverage.ts
 */

import { CRONS } from "@/config/crons";
import { findMissingPolicies } from "@/lib/automation/policy";
import { listRuleNames } from "@/lib/brain/autonomous-engine";

const HARD_MODE =
  process.env.POLICY_GATE_HARD === "1" ||
  (process.env.POLICY_GATE_SOFT !== "1" &&
    // Ratchet date — flip to HARD by default after 2026-05-10 (one week
    // soak after v10.0.148). Until then, warn-only.
    Date.now() >= new Date("2026-05-10").getTime());

async function main() {
  // Active + folded crons should have policies. Retired crons get a
  // policy too (with approvalClass=forbidden) so the gate doesn't
  // need to special-case mode here.
  const expected = CRONS.filter((c) => c.mode !== "retired").map(
    (c) => `cron.${c.name}`,
  );

  // 2026-08-22 · WIDENED past cron.*. This gate exists to catch the "rule
  // registered, no policy" deadlock and then only ever checked crons — so 17 of
  // 20 autonomous-action rules were invisible to it. The engine is fail-closed,
  // so each uncovered rule parks every match as pending forever.
  //
  // HARD from the start, same tier as crons. An earlier draft made this a WARN
  // tier "until seed-policies.ts is switched from its hand-curated array to
  // listRuleNames()" — but that switch lands in the SAME commit and the seed has
  // run, so coverage is complete right now and a hard tier passes. A dated warn
  // whose precondition is already met is just a 24-day hole for the exact defect
  // this gate exists to catch: rule #21 added without a re-seed would emit one
  // buried ⚠️ inside a 17-link chain, exit 0, and park every match indefinitely.
  const ruleExpected = listRuleNames().map((r) => `autonomous-action.${r.name}`);
  try {
    const missingRules = await findMissingPolicies(ruleExpected);
    if (missingRules.length > 0) {
      // Honour the SAME overrides the cron tier does and this script advertises at
      // its exit (`POLICY_GATE_SOFT=1 to demote to warning`). Reading only the date
      // made that documented escape hatch a lie for this tier: SOFT=1 demoted the
      // cron tier while this one still exited 1.
      const ruleHard = HARD_MODE;
      console.log(
        `  ${ruleHard ? "❌" : "⚠️ "}  ${missingRules.length}/${ruleExpected.length} autonomous-action rules have NO AutomationPolicy`,
      );
      for (const id of missingRules.slice(0, 5)) console.log(`     · ${id}`);
      if (missingRules.length > 5) console.log(`     · …and ${missingRules.length - 5} more`);
      console.log("     each parks every match as pending forever (fail-closed engine)");
      console.log("     fix: seed from listRuleNames(), not the curated array");
      if (ruleHard) {
        console.log("     emergency override: POLICY_GATE_SOFT=1 to demote to warning.");
        process.exit(1);
      }
    } else {
      console.log(`  ✅  all ${ruleExpected.length} autonomous-action rules have policies`);
    }
  } catch (e) {
    // Fail OPEN like the cron tier below — a contributor without DB access must
    // not be blocked. But SAY SO: this catch was originally silent, which made a
    // Prisma failure indistinguishable from the block not existing.
    // NOTE the wording. listRuleNames() is called OUTSIDE this try, so the only
    // thing that can throw in here is findMissingPolicies — a DB call. This can
    // never mean the RULE registry failed; that would escape to main().catch.
    console.warn(
      `  ⚠️  rule registry unreachable (${e instanceof Error ? e.message : e}) · skipping autonomous-action coverage`,
    );
  }

  if (expected.length === 0) {
    console.log("  ✅  no active crons declared (vacuously covered)");
    return;
  }

  let missing: string[];
  try {
    missing = await findMissingPolicies(expected);
  } catch (e) {
    // DB unreachable from a contributor's machine shouldn't block the
    // push — log and pass. CI runs against the prod DB so it'll catch
    // real gaps there.
    console.warn(
      `  ⚠️  policy registry unreachable (${e instanceof Error ? e.message : e}) · skipping coverage check`,
    );
    return;
  }

  if (missing.length === 0) {
    console.log(`  ✅  all ${expected.length} active crons have policies`);
    return;
  }

  const verb = HARD_MODE ? "❌" : "⚠️ ";
  console.log(
    `  ${verb}  ${missing.length} active cron${missing.length === 1 ? "" : "s"} missing AutomationPolicy entry:`,
  );
  for (const id of missing.slice(0, 10)) {
    console.log(`     · ${id}`);
  }
  if (missing.length > 10) console.log(`     · …and ${missing.length - 10} more`);
  console.log("");
  console.log(
    "  fix: add the cron to scripts/seed-policies.ts (or run the script if",
  );
  console.log(
    "       it's already declared) — `pnpm tsx scripts/seed-policies.ts`",
  );
  if (HARD_MODE) {
    console.log("");
    console.log("  emergency override: POLICY_GATE_SOFT=1 to demote to warning.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("policy-coverage check crashed:", e);
  // EXIT NON-ZERO. This previously logged and returned, so `verify:hard` printed
  // "policy-coverage check crashed: Cannot find module …" and still exited 0 —
  // both tiers silently dead while the chain reported success. scripts/ is excluded
  // from tsconfig.typecheck.json, so a renamed import is caught by nothing else.
  // A gate that cannot fail is not a gate.
  process.exit(1);
});
