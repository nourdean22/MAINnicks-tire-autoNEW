#!/usr/bin/env tsx
/**
 * scripts/pre-push-check.ts · Phase K (2026-05-18 PM)
 *
 * Orchestrator · runs the operator review pipeline in <10s before
 * `git push` lets the commits leave the operator's machine.
 *
 * Pipeline (parallel where possible):
 *   1. scan-secrets       · trufflehog-replacement · regex secret detection
 *   2. scan-prompt-injection · AI-engine misuse static checks
 *   3. lint-baseline --verify · no new lint warnings allowed
 *   4. typecheck           · catches type drift before push
 *
 * Exits non-zero on any failure. Wired into the existing
 * pnpm-postinstall hook that already references it.
 *
 * Bypass:
 *   git push --no-verify   · standard git escape hatch
 *   PRE_PUSH_SKIP=1 git push · env-var skip
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

interface CheckResult {
  name: string;
  ok: boolean;
  durationMs: number;
  output: string;
  blocking: boolean;
}

function runCheck(
  name: string,
  command: string,
  blocking = true,
): CheckResult {
  const startedAt = Date.now();
  try {
    const output = execSync(command, {
      encoding: "utf8",
      stdio: "pipe",
      maxBuffer: 50 * 1024 * 1024,
    });
    return {
      name,
      ok: true,
      durationMs: Date.now() - startedAt,
      output,
      blocking,
    };
  } catch (err) {
    const stdout = (err as { stdout?: string }).stdout ?? "";
    const stderr = (err as { stderr?: string }).stderr ?? "";
    return {
      name,
      ok: false,
      durationMs: Date.now() - startedAt,
      output: stdout + stderr,
      blocking,
    };
  }
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function main(): void {
  if (process.env.PRE_PUSH_SKIP === "1") {
    console.log("⊘ pre-push · skipped via PRE_PUSH_SKIP=1");
    process.exit(0);
  }

  // Skip if not run from a git repo (CI installs, fresh clones with no .git)
  if (!existsSync(".git") && !existsSync("../../.git")) {
    console.log("⊘ pre-push · skipped · not in a git checkout");
    process.exit(0);
  }

  const startedAt = Date.now();
  console.log("▶ pre-push-check · running operator review pipeline...");

  const results: CheckResult[] = [
    runCheck(
      "scan-secrets",
      "pnpm tsx apps/statenour/scripts/scan-secrets.ts --staged",
    ),
    runCheck(
      "scan-prompt-injection",
      "pnpm tsx apps/statenour/scripts/scan-prompt-injection.ts",
    ),
    runCheck(
      "lint-baseline",
      "pnpm tsx apps/statenour/scripts/lint-baseline.ts --verify",
    ),
    runCheck(
      "typecheck",
      "pnpm --filter @statenour/web typecheck",
    ),
  ];

  const totalMs = Date.now() - startedAt;
  const failed = results.filter((r) => !r.ok && r.blocking);

  console.log("\n── pre-push-check summary ──");
  for (const r of results) {
    const tag = r.ok ? "✓" : "✗";
    console.log(`${tag} ${r.name.padEnd(24)} ${fmtMs(r.durationMs)}`);
    if (!r.ok && r.output) {
      console.log(
        "  " + r.output.split("\n").slice(0, 30).join("\n  "),
      );
    }
  }
  console.log(`── total ${fmtMs(totalMs)} ──`);

  if (failed.length > 0) {
    console.error(
      `\n✗ ${failed.length} check(s) failed · push blocked.`,
    );
    console.error(
      `  Bypass (use sparingly): git push --no-verify  OR  PRE_PUSH_SKIP=1 git push`,
    );
    process.exit(1);
  }
  console.log(`\n✓ all checks passed`);
  process.exit(0);
}

main();
