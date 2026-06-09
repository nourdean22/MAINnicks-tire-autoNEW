/**
 * CLI · Memory-eval truth scoreboard.
 *
 * Grades each eval in lib/evals/memory-evals.ts against the repo doc that
 * should teach it (deterministic — no LLM, no DB). Prints a per-category
 * scoreboard.
 *
 * Exit nonzero when:
 *   · the dataset is malformed, or
 *   · a CRITICAL eval grounded against a present doc FAILS (a truth doc lost a
 *     fact it must teach — a real regression).
 * "manual" evals (no grounding doc on disk yet) never fail the run.
 *
 * Run:  pnpm eval:memory
 */

import fs from "node:fs";
import path from "node:path";
import { MEMORY_EVALS } from "../lib/evals/memory-evals";
import { runMemoryEvals } from "../lib/evals/memory-eval-runner";

function main(): void {
  const cwd = process.cwd();

  // Read every distinct grounding doc that exists on disk.
  const sources: Record<string, string> = {};
  const docs = new Set(MEMORY_EVALS.map((e) => e.groundingDoc).filter(Boolean) as string[]);
  for (const rel of docs) {
    const full = path.join(cwd, rel);
    if (fs.existsSync(full)) sources[rel] = fs.readFileSync(full, "utf8");
  }

  const r = runMemoryEvals(MEMORY_EVALS, { sources });

  console.log("");
  console.log("memory-eval truth scoreboard");
  console.log("");
  console.log(`  total ${r.total} · pass ${r.passed} · fail ${r.failed} · manual ${r.manual}`);
  console.log("");
  console.log("  by category:");
  for (const [cat, b] of Object.entries(r.byCategory).sort()) {
    console.log(`    ${cat.padEnd(22)} ${b.passed}/${b.total} pass${b.failed ? ` · ${b.failed} FAIL` : ""}${b.manual ? ` · ${b.manual} manual` : ""}`);
  }

  const fails = r.results.filter((x) => x.status === "fail");
  if (fails.length) {
    console.log("");
    console.log("  failures:");
    for (const f of fails) {
      console.log(`    ❌ [${f.severity}] ${f.id} (${f.source})`);
      if (f.missingFacts.length) console.log(`         missing: ${f.missingFacts.join(", ")}`);
      if (f.presentForbidden.length) console.log(`         forbidden present: ${f.presentForbidden.join(", ")}`);
    }
  }

  const manual = r.results.filter((x) => x.status === "manual");
  if (manual.length) {
    console.log("");
    console.log(`  manual (${manual.length}) — no grounding doc on disk yet:`);
    for (const m of manual) console.log(`    · ${m.id}${m.note ? ` (${m.note})` : ""}`);
  }

  console.log("");
  if (r.datasetIssues.length) {
    console.error("✖ dataset invalid:");
    for (const i of r.datasetIssues) console.error(`    - ${i}`);
    process.exit(1);
  }
  if (r.criticalFailures.length) {
    console.error(`✖ ${r.criticalFailures.length} CRITICAL grounded eval(s) failed — a truth doc lost a required fact`);
    process.exit(1);
  }
  console.log(`✓ scoreboard clean (${r.passed} grounded pass · ${r.manual} manual · 0 critical fail)`);
  process.exit(0);
}

const invokedDirectly =
  typeof process.argv[1] === "string" && /run-memory-evals\.(ts|js|mjs)$/.test(process.argv[1]);
if (invokedDirectly) main();
