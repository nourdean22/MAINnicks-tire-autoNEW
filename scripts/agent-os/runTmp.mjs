/**
 * Run-scoped temp dir for a test run (2026-10-21).
 *
 * Tests make fixtures with mkdtempSync(join(tmpdir(), "<prefix>")) and almost none delete
 * them: one machine collected 14,373 temp dirs in two days, nearly all test fixtures. Instead of patching
 * ~130 test files, each runner points TEMP/TMP/TMPDIR (what os.tmpdir() reads) at one
 * fresh dir and deletes that dir when the run ends. Users: verify.mjs (agent-os node:test
 * suite) and, through the default export, the nickstire and statenour vitest globalSetup.
 * Canary: runTmp.test.mjs.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const RUN_TMP_ENV = "TEST_RUN_TMP";

export function createRunTmp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return {
    dir,
    env: { TEMP: dir, TMP: dir, TMPDIR: dir, [RUN_TMP_ENV]: dir },
    // rmSync unlinks junctions/symlinks instead of following them; a file still held open
    // (a stray child process) leaves the dir behind with a warning, never a failed run.
    cleanup() {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
        return true;
      } catch (err) {
        console.warn(`[runTmp] could not remove ${dir}: ${err.message}`);
        return false;
      }
    },
  };
}

// vitest globalSetup: workers are forked after this runs, so they inherit the env.
export default function setup() {
  const run = createRunTmp("vitest-run-");
  Object.assign(process.env, run.env);
  return () => run.cleanup();
}
