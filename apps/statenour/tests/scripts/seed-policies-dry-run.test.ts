/**
 * The seed the coverage gate prescribes must be able to RUN — behaviourally.
 *
 * `check:policy-coverage` tells the operator to run `scripts/seed-policies.ts`
 * when a cron has no AutomationPolicy row. Until #2478 that script crashed at
 * module load on Next's `server-only` tripwire under plain `tsx`, so the gate's
 * own remedy was dead. #2478 fixed it with a `Module._load` stub plus DYNAMIC
 * imports inside `main()` — and shipped no test that exercised the fix: the
 * derivation tests read the script as text, and the coverage-runner test spawns
 * the OTHER script. A future static import would crash the seed again with
 * `verify:hard` green (review on #2478, correct).
 *
 * Two halves, per AGENTS.md "ship the canary, not just the control":
 *   · the seed, spawned with `--dry-run` and NO database credentials, prints
 *     output only `main()`'s dry-run body can produce and exits 0;
 *   · the CONTROL spawns the same import chain STATICALLY with no stub and must
 *     crash on the tripwire — proving the tripwire is live in this environment,
 *     so the positive half is a real result and not a stale package.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve(process.cwd(), "scripts/seed-policies.ts");
const CONTROL = resolve(process.cwd(), "tests/scripts/fixtures/server-only-tripwire-control.ts");
const TSX = resolve(
  dirname(createRequire(import.meta.url).resolve("tsx/package.json")),
  "dist/cli.mjs",
);

/** The exact signature of the crash #2478 removed. */
const SERVER_ONLY_CRASH = "cannot be imported from a Client Component";

function run(file: string, args: string[] = []) {
  const env = { ...process.env };
  // No database: the dry run must not need one, and this test must never
  // touch a real registry.
  delete env.DATABASE_URL;
  delete env.POSTGRES_URL;
  return spawnSync(process.execPath, [TSX, file, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
    timeout: 120_000,
  });
}

describe("seed-policies --dry-run · the gate's prescribed remedy can actually run", () => {
  const r = run(SCRIPT, ["--dry-run"]);
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;

  it("POSITIVE CONTROL: the probe really executed the script", () => {
    expect(r.error, `spawn failed: ${r.error?.message}`).toBeUndefined();
    expect(out.length, "no output at all — the script never ran").toBeGreaterThan(0);
  });

  it("does not die on the server-only tripwire at module load", () => {
    expect(out, "a static import of the policy/engine modules re-introduces this").not.toContain(
      SERVER_ONLY_CRASH,
    );
  });

  it("REACHES the dry-run body — output only main() can produce — and exits 0 with no database", () => {
    expect(out).toContain("seed-policies · DRY RUN");
    expect(out).toContain("(dry-run · no DB writes)");
    expect(r.status, `exit ${r.status}; tail: ${out.slice(-600)}`).toBe(0);
  });

  it("BROKEN-CASE CONTROL: the same import chain with no stub still trips — the stub is load-bearing", () => {
    const c = run(CONTROL);
    const cout = `${c.stdout ?? ""}${c.stderr ?? ""}`;
    expect(c.error, `spawn failed: ${c.error?.message}`).toBeUndefined();
    expect(c.status, "the control must FAIL; if it passes, the tripwire moved and this suite proves nothing").not.toBe(0);
    expect(cout).toContain(SERVER_ONLY_CRASH);
    expect(cout).not.toContain("control: server-only did not trip");
  });
});
