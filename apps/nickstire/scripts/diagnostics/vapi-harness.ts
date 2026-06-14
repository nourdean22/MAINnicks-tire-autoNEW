/**
 * Manual / one-shot VAPI harness runner.
 *
 * Run from anywhere (laptop, Railway shell):
 *   pnpm tsx apps/nickstire/scripts/vapi-harness.ts
 *
 * Same checks as the nightly cron · same verdict. Use when:
 *   · Just shipped a vapi config change · verify it stuck
 *   · A customer complained about a missed booking · prove the path
 *   · Investigating a Telegram alert from the cron
 *
 * Exits 0 on all-pass · 1 on any failure (so it can gate CI/release).
 */

import "dotenv/config";
import { runVapiHarness } from "../../server/services/vapi-harness";

async function main() {
  console.log("\n═══ VAPI Harness · synthetic-call eval ═══\n");
  const result = await runVapiHarness();

  for (const c of result.checks) {
    const tag = c.pass ? "✅" : "🔴";
    const detail = c.err ?? c.details ?? "";
    console.log(`  ${tag}  ${c.name}${detail ? ` · ${detail}` : ""}`);
  }

  console.log(`\n${result.summary}\n`);
  process.exit(result.pass ? 0 : 1);
}

main().catch((err) => {
  console.error("Harness threw:", err instanceof Error ? err.message : err);
  process.exit(1);
});
