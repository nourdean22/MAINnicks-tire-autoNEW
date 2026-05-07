/**
 * Blog seeder eval runner — loads eval-set.json, invokes generateArticle()
 * for each example, runs criteria predicates, exits non-zero if any
 * example fails the threshold.
 *
 * Usage:
 *   pnpm tsx server/lib/ai/evals/blog-seeder/runner.ts
 *
 * Pass threshold: 90% of criteria must pass per example. (Some criteria
 * are heuristic — concession-first, insider vocab — and aren't always
 * present in legitimate output. 90% allows for that without permitting
 * broad regressions.)
 *
 * Wave-62 (2026-05-07).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateArticle } from "../../../../content-generator";
import { runAllCriteria } from "./criteria";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_SET_PATH = path.join(__dirname, "eval-set.json");

interface EvalExample {
  id: string;
  input: { topic: string };
  expectedTraits: string[];
}

interface EvalSet {
  feature: string;
  description: string;
  version: number;
  examples: EvalExample[];
}

const PASS_THRESHOLD = 0.9; // 90% of criteria must pass

const c = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

async function main() {
  const evalSetRaw = fs.readFileSync(EVAL_SET_PATH, "utf-8");
  const evalSet: EvalSet = JSON.parse(evalSetRaw);

  console.log(`${c.cyan}━━ Eval: ${evalSet.feature} v${evalSet.version} ━━${c.reset}`);
  console.log(`${c.dim}${evalSet.description}${c.reset}\n`);

  let totalExamples = 0;
  let passingExamples = 0;
  const failureSummary: Array<{ id: string; failures: Array<{ name: string; reason?: string }> }> = [];

  for (const ex of evalSet.examples) {
    totalExamples += 1;
    process.stdout.write(`  ${c.dim}→ running ${ex.id}...${c.reset} `);

    try {
      const article = await generateArticle(ex.input.topic);
      const result = runAllCriteria(article);
      const passRate = result.total > 0 ? result.passed / result.total : 0;

      if (passRate >= PASS_THRESHOLD) {
        passingExamples += 1;
        console.log(`${c.green}✓ ${result.passed}/${result.total}${c.reset}`);
      } else {
        console.log(`${c.red}✗ ${result.passed}/${result.total}${c.reset}`);
        failureSummary.push({ id: ex.id, failures: result.failed });
      }
    } catch (err) {
      console.log(`${c.red}✗ THREW${c.reset}`);
      failureSummary.push({
        id: ex.id,
        failures: [{ name: "exception", reason: err instanceof Error ? err.message : String(err) }],
      });
    }
  }

  console.log("");
  if (failureSummary.length > 0) {
    console.log(`${c.red}━━ FAILURE DETAILS ━━${c.reset}`);
    for (const f of failureSummary) {
      console.log(`\n  ${c.yellow}${f.id}${c.reset}`);
      for (const fail of f.failures) {
        console.log(`    ${c.red}✗ ${fail.name}${c.reset}${fail.reason ? `: ${c.dim}${fail.reason}${c.reset}` : ""}`);
      }
    }
    console.log("");
  }

  const passingPct = ((passingExamples / totalExamples) * 100).toFixed(0);
  const summaryColor = passingExamples === totalExamples ? c.green : c.red;
  console.log(
    `${summaryColor}━━ Summary: ${passingExamples}/${totalExamples} examples passed (${passingPct}%) ━━${c.reset}`,
  );

  // Exit non-zero if any example failed (CI-blocking)
  if (passingExamples < totalExamples) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${c.red}Eval runner crashed:${c.reset}`, err);
  process.exit(2);
});
