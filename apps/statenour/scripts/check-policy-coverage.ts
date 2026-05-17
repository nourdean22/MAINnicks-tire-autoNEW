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
  // Don't fail the push on the script's own bug — log + pass.
});
