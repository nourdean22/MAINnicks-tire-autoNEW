/**
 * The policy-coverage gate must be able to RUN.
 *
 * WHAT THIS FREEZES. `check:policy-coverage` is wired into `verify:hard` and
 * is in HARD mode (its ratchet date passed in May 2026). It never ran.
 * `lib/brain/autonomous-engine` transitively imports `lib/ai/budget.ts:9`,
 * which imports `server-only` — a Next.js tripwire whose entry throws by
 * design and that only the Next bundler rewrites to a no-op. Under plain `tsx`
 * it threw at module load, so the script died before `main()`.
 *
 * A gate that is correctly wired and always crashes is worse than a missing
 * one: `verify:hard` reported a failure nobody read as "this specific gate is
 * dead", and the gap it exists to catch went uncaught. When the crash was
 * fixed the gate immediately found TWO active crons with no AutomationPolicy
 * row — `cron.device-heartbeat-sentinel` and `cron.agent-followups` — whose
 * every fire is therefore recorded nowhere (`logPolicyFire` finds 0 rows,
 * warns `policy_fire_missing_registry`, and returns before writing the event).
 *
 * WHY THE FIX IS NOT JUST A STUB. ESM hoists static `import` above every
 * statement, so a `Module._load` stub at the top still runs AFTER the
 * offending module is evaluated. The two imports that reach `server-only` are
 * loaded DYNAMICALLY inside `main()`. Reverting either to a static import
 * re-breaks the gate — and fails this test.
 *
 * It is deliberately run WITHOUT DATABASE_URL: the script fails OPEN on an
 * unreachable registry, so reaching that message proves `main()` was entered,
 * which is the whole claim. It does not assert the coverage verdict, because
 * that depends on prod data this test has no business reading.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve(process.cwd(), "scripts/check-policy-coverage.ts");
const TSX = resolve(
  dirname(createRequire(import.meta.url).resolve("tsx/package.json")),
  "dist/cli.mjs",
);

/** The exact signature of the crash this repair removed. */
const SERVER_ONLY_CRASH = "cannot be imported from a Client Component";

function run() {
  const env = { ...process.env };
  // Force the fail-open path; this test must never touch a real registry.
  delete env.DATABASE_URL;
  delete env.POSTGRES_URL;
  return spawnSync(process.execPath, [TSX, SCRIPT], {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
    timeout: 120_000,
  });
}

describe("check:policy-coverage · the gate can actually run", () => {
  const r = run();
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;

  it("does not die on the server-only tripwire at module load", () => {
    expect(out, "a static import of autonomous-engine re-introduces this").not.toContain(
      SERVER_ONLY_CRASH,
    );
  });

  it("REACHES main() — proven by output only main() can produce", () => {
    // Any of these means the body ran. Without the fix, none appear because
    // the process dies before the first line of main().
    expect(out).toMatch(
      /autonomous-action rules|active crons|registry unreachable|vacuously covered/,
    );
  });

  it("POSITIVE CONTROL: the probe really executed the script", () => {
    // Guards against a spawn that silently failed to start, which would make
    // both assertions above pass against an empty string.
    expect(r.error, `spawn failed: ${r.error?.message}`).toBeUndefined();
    expect(out.length, "no output at all — the script never ran").toBeGreaterThan(0);
  });
});
