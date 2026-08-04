#!/usr/bin/env node
/**
 * agent-os verification entry point (Agent OS v1 · 2026-08-04).
 *
 * ONE command that CI and humans both run: `pnpm agent:verify`.
 *
 * It composes two kinds of check and DISCOVERS the second kind, so adding a new
 * guard never requires editing .github/workflows/** (touching that path escalates
 * this repo's CI to a full ~50-minute turbo sweep — see docs/agent-os/README.md):
 *
 *   1. Adapter parity      — check-adapters.mjs (instruction architecture contract)
 *   2. Policy canaries     — every scripts/agent-os/*.test.mjs, run under node:test
 *
 * Zero dependencies. Node's built-in test runner only; no vitest, no install step.
 * Exit 0 = all green · 1 = a check failed · 2 = the harness itself is broken.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

const results = [];

function run(label, argv) {
  process.stdout.write(`\n── ${label} ${"─".repeat(Math.max(0, 58 - label.length))}\n`);
  const r = spawnSync(process.execPath, argv, { cwd: ROOT, stdio: "inherit" });
  if (r.error) {
    console.error(`\n[agent-os] could not run ${label}: ${r.error.message}`);
    process.exit(2);
  }
  results.push({ label, code: r.status ?? 1 });
}

// 1 · Adapter parity (always present).
run("adapter parity", [join(HERE, "check-adapters.mjs")]);

// 2 · Policy canaries — auto-discovered. Absent in the instruction-only phase;
//     they appear with the enforcement layer and are picked up with no CI edit.
let testFiles = [];
try {
  testFiles = readdirSync(HERE)
    .filter((f) => f.endsWith(".test.mjs"))
    .sort()
    .map((f) => join(HERE, f));
} catch (err) {
  console.error(`[agent-os] cannot read ${HERE}: ${err.message}`);
  process.exit(2);
}

if (testFiles.length) {
  run(`policy canaries (${testFiles.length} file${testFiles.length > 1 ? "s" : ""})`, [
    "--test",
    ...testFiles,
  ]);
} else {
  console.log("\n── policy canaries ───────────────────────────────────────");
  console.log("none found (scripts/agent-os/*.test.mjs) — skipping");
}

// ── Summary ─────────────────────────────────────────────────────────────────
const failed = results.filter((r) => r.code !== 0);
console.log("\n" + "═".repeat(62));
for (const r of results) console.log(`${r.code === 0 ? "PASS" : "FAIL"}  ${r.label}`);
console.log("═".repeat(62));

if (failed.length) {
  console.error(`\nagent-os verify FAILED — ${failed.map((f) => f.label).join(", ")}`);
  process.exit(1);
}
console.log("\nagent-os verify: all checks green");
