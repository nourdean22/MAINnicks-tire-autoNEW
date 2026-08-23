/**
 * Every link in `pnpm run verify` must also run in CI.
 *
 * ─── The defect this replaces ──────────────────────────────────────────
 *
 * Measured 2026-08-23 against origin/main: `lint:sql`,
 * `prerender:semantic-check` and `migrations:check` were links in the master
 * `verify` chain and appeared ZERO times across all eight files in
 * `.github/workflows/`. They gated only if someone ran the full local
 * `verify` — while root AGENTS.md actively discourages exactly that on this
 * shared machine ("Don't run full-repo sweeps 'for a baseline' — sibling
 * sessions share this machine"). The instruction and the enforcement pointed
 * in opposite directions, so in practice those three gated nothing.
 *
 * Adding the three missing steps fixes today. This test fixes tomorrow: the
 * NEXT gate added to `verify` and forgotten in CI fails here, by name.
 *
 * ─── Why a test and not a doc line ─────────────────────────────────────
 *
 * The same audit found a doc sentence ("every job in it duplicates a tiered
 * job EXCEPT the two above") that closed a question a script could have kept
 * open, and two crons stayed dead for months behind it. A checklist entry
 * saying "remember to add new gates to CI" would have the identical failure
 * mode. Never let a doc close a question a check could keep open.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const APP_ROOT = process.cwd();
const REPO_ROOT = join(APP_ROOT, "..", "..");

const pkg = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf-8")) as {
  scripts: Record<string, string>;
};
const workflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "test.yml"), "utf-8");

/**
 * Links covered by the turbo sweep (`turbo run check lint test build
 * --affected`) rather than by a named step. Each is here with its reason;
 * an entry with no justification is how an exemption list rots into an
 * excuse list.
 */
const COVERED_BY_TURBO: Record<string, string> = {
  // `turbo run check` -> nickstire `check` = `tsc --noEmit` on tsconfig.json.
  // `typecheck:raw` is the SAME config with test files excluded, so the turbo
  // task is strictly broader. Verified by reading tsconfig.typecheck.json:
  // it is `extends: ./tsconfig.json` plus an `exclude` list, nothing else.
  "typecheck:raw": "turbo run check is the same tsc over a strictly larger file set",
  lint: "turbo run lint runs this exact script",
  test: "turbo run test runs this exact script",
  build: "turbo run build runs this exact script",
};

/** Parse the `&&`-chain in the verify script into its `pnpm run X` links. */
function verifyLinks(): string[] {
  const verify = pkg.scripts.verify;
  expect(verify, "package.json must still define a verify script").toBeTruthy();
  return [...verify.matchAll(/pnpm run ([a-z0-9:_-]+)/g)].map((m) => m[1]);
}

describe("CI gate parity · every verify link runs in CI", () => {
  it("the instrument sees its target", () => {
    // If the parse breaks, every assertion below passes vacuously — the
    // "a scan that matched nothing and a scan that ran on nothing print the
    // same green" trap from AGENTS.md.
    const links = verifyLinks();
    expect(links.length, "verify chain should have many links").toBeGreaterThan(10);
    expect(links).toContain("lint:source");
    expect(workflow.length, "test.yml should be readable").toBeGreaterThan(1000);
    expect(workflow).toContain("pnpm --filter nicks-tire-auto");
  });

  it("every verify link is either a named CI step or turbo-covered", () => {
    const missing = verifyLinks().filter((link) => {
      if (link in COVERED_BY_TURBO) return false;
      return !workflow.includes(`pnpm --filter nicks-tire-auto ${link}`);
    });
    expect(
      missing,
      `these verify links run in NO CI job — add a step to .github/workflows/test.yml, ` +
        `or add a justified entry to COVERED_BY_TURBO if turbo already runs them`,
    ).toEqual([]);
  });

  it("the three links this PR wired are named steps, not turbo-covered", () => {
    // Named individually so a revert is loud rather than silently re-exempted.
    for (const link of ["lint:sql", "prerender:semantic-check", "migrations:check"]) {
      expect(workflow, `${link} must be an explicit CI step`).toContain(
        `pnpm --filter nicks-tire-auto ${link}`,
      );
      expect(COVERED_BY_TURBO[link], `${link} must not be exempted`).toBeUndefined();
    }
  });

  it("BREAKS: a verify link absent from CI is reported by name", () => {
    // Drive the same comparison with a fabricated chain, proving the check
    // fails rather than trusting that it would.
    const fakeLinks = ["lint:source", "lint:this-gate-does-not-exist-in-ci"];
    const missing = fakeLinks.filter((link) => {
      if (link in COVERED_BY_TURBO) return false;
      return !workflow.includes(`pnpm --filter nicks-tire-auto ${link}`);
    });
    expect(missing).toEqual(["lint:this-gate-does-not-exist-in-ci"]);
  });

  it("every turbo exemption carries a reason", () => {
    for (const [link, reason] of Object.entries(COVERED_BY_TURBO)) {
      expect(reason.length, `${link} exemption must be justified`).toBeGreaterThan(20);
      // An exemption for a script that no longer exists is dead weight.
      expect(pkg.scripts[link], `${link} is exempted but no longer a script`).toBeTruthy();
    }
  });

  it("turbo exemptions name tasks turbo actually runs", () => {
    // If `turbo run check lint test build` ever loses a task, the exemption
    // that leans on it becomes a silent hole.
    const sweep = workflow.match(/turbo run ([a-z ]+) --affected/);
    expect(sweep, "the turbo --affected sweep should still be in test.yml").toBeTruthy();
    const tasks = sweep![1].trim().split(/\s+/);
    for (const reason of Object.values(COVERED_BY_TURBO)) {
      const task = reason.match(/turbo run ([a-z:]+)/)?.[1];
      if (task) expect(tasks, `turbo no longer runs "${task}"`).toContain(task);
    }
  });
});

describe("CI honesty · the notify summary cannot claim success over a red gate", () => {
  it("the Slack status is derived from every upstream job, not just node", () => {
    // The regression: `status="SUCCESS"; if node == failure -> FAILED`, which
    // reported SUCCESS while `security` — the repo's only dependency gate —
    // was red. Currently inert (SLACK_WEBHOOK_URL is not a configured repo
    // secret), which is why this asserts the code shape rather than behaviour.
    //
    // Assert the `needs.<job>.result` BINDING, not the shell variable name.
    // The first draft checked `notify.toContain("SECURITY_RESULT")` and a
    // mutation probe that deleted the env declaration still passed — the name
    // survived in the loop body that reads it. A check satisfied by the
    // reference to a value it never confirms is wired is not a check.
    const notify = workflow.slice(workflow.indexOf("Notify Slack"));
    for (const job of ["node", "security", "railway-smoke"]) {
      expect(notify, `Slack status must bind needs.${job}.result`).toContain(
        `needs.${job}.result`,
      );
    }
    // And the verdict must be computed from them, not hardcoded per-job.
    expect(notify, "status should be derived by loop, not a single if").toMatch(/for job in/);
  });

  it("the step summary reports the security job", () => {
    const summary = workflow.slice(workflow.indexOf("Generate Summary"));
    expect(summary).toContain("needs.security.result");
  });
});
