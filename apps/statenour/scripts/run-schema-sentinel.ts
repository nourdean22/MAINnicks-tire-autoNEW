/**
 * One-shot manual run of the schema-drift sentinel · v10.0.155
 *
 * Pure read — calls runSchemaDriftCheck() and prints the report. Used
 * to verify the EXPECTATIONS list is fully green after a recovery
 * (e.g. v10.0.154 pgvector + tsvector restoration).
 *
 * Usage:
 *   set -a && . ./.env.local && set +a
 *   pnpm tsx scripts/run-schema-sentinel.ts
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { runSchemaDriftCheck } from "../lib/db/schema-sentinel";

async function main() {
  console.log("running schema sentinel…\n");
  const report = await runSchemaDriftCheck();

  console.log(`checked at: ${report.checkedAt}`);
  console.log(`reachable:  ${report.reachable}`);
  console.log(`expectations: ${report.expectationCount}`);
  console.log(`findings:   ${report.findings.length}`);

  if (report.ok) {
    console.log("\n✅  schema is clean · no drift detected");
    process.exit(0);
  }

  console.log("\n⚠️  drift findings:");
  for (const f of report.findings) {
    const sev =
      f.severity === "high" ? "❌" : f.severity === "medium" ? "⚠ " : "·";
    console.log(`  ${sev} [${f.severity}] ${f.problem}`);
  }
  process.exit(report.findings.some((f) => f.severity === "high") ? 1 : 0);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
