/**
 * Nick quality eval runner — prints the 20-criterion agent-quality
 * scoreboard. Deterministic, no model/DB. Exit 1 if any criterion fails.
 *
 *   pnpm tsx scripts/run-nick-quality-evals.ts
 */
import { runNickQualityEvals } from "@/lib/ai/evals/nick-quality-evals";

const results = runNickQualityEvals();
let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`[${r.pass ? "PASS" : "FAIL"}] #${String(r.id).padStart(2, " ")} ${r.criterion}  ·  ${r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} criteria passing.`);
process.exit(failed > 0 ? 1 : 0);
