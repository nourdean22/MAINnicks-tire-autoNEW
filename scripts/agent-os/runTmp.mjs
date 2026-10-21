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
import { lstatSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const RUN_TMP_ENV = "TEST_RUN_TMP";
// A live run keeps creating fixtures at the top of its dir, which refreshes the dir's mtime.
const STALE_MS = 6 * 3600_000;

/** Remove run dirs with this prefix untouched for STALE_MS: left by a run killed before its cleanup. */
function sweepStale(prefix) {
  const base = tmpdir();
  for (const name of readdirSync(base)) {
    if (!name.startsWith(prefix)) continue;
    const p = join(base, name);
    try {
      const st = lstatSync(p);
      if (st.isDirectory() && Date.now() - st.mtimeMs > STALE_MS) rmSync(p, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // gone already, or still held open: the next run tries again
    }
  }
}

export function createRunTmp(prefix) {
  sweepStale(prefix);
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
