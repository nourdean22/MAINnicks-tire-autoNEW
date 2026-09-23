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
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

const results = [];

// GitHub API budget meter (2026-09-23): every ghFetch() in every spawned test appends
// one line here (github-client.mjs), and the summary below prints the run's total and
// top consumers. CI's token gets ~1,000 requests/hour per repo; a live canary that
// silently grew to 657 requests per run exhausted it before anyone saw the number.
const GH_CALL_LOG = process.env.AGENT_OS_GH_CALL_LOG || join(mkdtempSync(join(tmpdir(), "agent-os-gh-")), "calls.jsonl");
process.env.AGENT_OS_GH_CALL_LOG = GH_CALL_LOG;

function run(label, argv) {
  process.stdout.write(`\n── ${label} ${"─".repeat(Math.max(0, 58 - label.length))}\n`);
  // Session Authority canaries (2026-09-23) make live GitHub API calls via
  // github-client.mjs, whose fetch() silently 401s behind this environment's proxy
  // unless NODE_USE_ENV_PROXY=1 is set from process START — setting it inside a
  // running script does nothing (verified). A spawned child is a fresh process, so
  // setting it here is the correct place, once, for every discovered test file,
  // rather than each one re-exec'ing itself individually. NODE_NO_WARNINGS rides
  // along: enabling the env-proxy-agent makes Node print a one-time "[UNDICI-EHPA]
  // Warning: EnvHttpProxyAgent is experimental" line to stderr, which broke
  // memoryHook.test.mjs's unrelated "nothing operator-facing goes to stderr"
  // canary the first time this line was added without it — caught by running the
  // FULL suite, not just the new tests, before trusting this change.
  const env = process.env.HTTPS_PROXY ? { ...process.env, NODE_USE_ENV_PROXY: "1", NODE_NO_WARNINGS: "1" } : process.env;
  const r = spawnSync(process.execPath, argv, { cwd: ROOT, stdio: "inherit", env });
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
const calls = existsSync(GH_CALL_LOG) ? readFileSync(GH_CALL_LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const byScript = {};
for (const c of calls) byScript[c.script] = (byScript[c.script] ?? 0) + 1;
const top = Object.entries(byScript).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v}`);
console.log(`\nGitHub API requests this run: ${calls.length}${top.length ? ` (${top.join(", ")})` : ""}`);

const failed = results.filter((r) => r.code !== 0);
console.log("\n" + "═".repeat(62));
for (const r of results) console.log(`${r.code === 0 ? "PASS" : "FAIL"}  ${r.label}`);
console.log("═".repeat(62));

if (failed.length) {
  console.error(`\nagent-os verify FAILED — ${failed.map((f) => f.label).join(", ")}`);
  process.exit(1);
}
console.log("\nagent-os verify: all checks green");
