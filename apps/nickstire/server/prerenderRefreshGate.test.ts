/**
 * The prerender refresh writes to main with no PR — so it must gate itself.
 *
 * THE HOLE. `.github/workflows/prerender-refresh.yml` runs `pnpm run regen` and
 * pushes the result straight to a branch. There is no pull request, so not one
 * of the checks that guard a PR has ever run against what it commits. That is
 * how three blog artifacts reached Google as Soft 404s: this workflow wrote
 * them, and the gate that would have caught them only ever ran on PRs.
 *
 * THE TRAP THE FIX ITSELF CREATED. check-prerender-semantic.mjs is fatal in
 * both directions on purpose — a new empty artifact fails, and so does a
 * baseline row that no longer reproduces, because a list that may quietly hold
 * fixed entries teaches readers it is decorative. But that second rule means
 * the moment a refresh actually FIXES a named page, every open PR in the repo
 * goes red on a stale row until a human prunes it. A gate that fires on success
 * is a gate people learn to switch off. So the refresh prunes the ledger in the
 * same commit that fixes the pages — and the pruner refuses to grow, or the
 * ratchet becomes a rubber stamp whose remedy for a red is "re-run the script".
 *
 * These are source-order and behaviour assertions rather than a workflow run:
 * the ordering IS the invariant (gate before commit, prune before push), and
 * ordering is exactly what a green workflow run cannot demonstrate.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const APP = process.cwd();
const REPO = resolve(APP, "..", "..");
const workflow = readFileSync(resolve(REPO, ".github/workflows/prerender-refresh.yml"), "utf8");

describe("the refresh gates what it pushes", () => {
  it("runs the empty-artifact gate at all", () => {
    // The positive control for every ordering assertion below: if the step is
    // gone, those indexOf comparisons would be comparing -1 to -1.
    expect(workflow).toContain("update-thin-prerender-baseline.mjs");
    expect(workflow).toContain("prerender:semantic-check");
    expect(workflow).toContain("prerender:check");
  });

  it("gates BEFORE it commits — the ordering that is the whole point", () => {
    const gate = workflow.indexOf("update-thin-prerender-baseline.mjs");
    const semantic = workflow.indexOf("prerender:semantic-check");
    const commit = workflow.indexOf("git commit -m");
    expect(commit, "the commit step must still exist").toBeGreaterThan(-1);
    expect(gate, "the baseline gate must run before the commit").toBeLessThan(commit);
    expect(semantic, "the semantic gate must run before the commit").toBeLessThan(commit);
  });

  it("commits the pruned baseline together with the artifacts", () => {
    // Split across two commits, the fixed page lands and the stale row does
    // not — which is the red-on-success case this exists to prevent.
    const add = /git add ([^\n]+)/.exec(workflow)?.[1] ?? "";
    expect(add).toContain("apps/nickstire/prerendered");
    expect(add).toContain("config/thin-prerender-baseline.json");
  });

  it("its change-detection watches the baseline too", () => {
    // `git status --porcelain -- <paths>` is what decides whether anything is
    // committed at all. A path missing here is a change that silently never
    // ships — this exact line was widened in 2026-07-09 for the same reason.
    const status = /git status --porcelain -- ([^)\n]+)/.exec(workflow)?.[1] ?? "";
    expect(status).toContain("apps/nickstire/prerendered");
    expect(status).toContain("config/thin-prerender-baseline.json");
  });

  it("still pushes to the ref it rendered, not a hard-coded main", () => {
    // Regression guard for the 2026-09-10 cloaking incident: the dispatch ref
    // chose the CODE and had no say over the DESTINATION, so a feature branch's
    // routes were rendered and written to main.
    expect(workflow).toContain("TARGET_BRANCH: ${{ github.ref_name }}");
    expect(workflow).not.toMatch(/git push origin "HEAD:main"/);
  });
});

describe("the baseline regenerator is a ratchet, not a rubber stamp", () => {
  const script = readFileSync(resolve(APP, "scripts/update-thin-prerender-baseline.mjs"), "utf8");

  it("refuses to add, and says so with a non-zero exit", () => {
    expect(script).toContain("REFUSING");
    expect(script).toContain("process.exit(1)");
  });

  it("imports the shared scanner rather than re-implementing it", () => {
    // The fail-open-slice pair in this same directory drifted TWICE when the
    // gate and its regenerator each carried a copy of the scan.
    expect(script).toContain("./lib/prerenderText.mjs");
    expect(script).toContain("emptyArtifacts");
  });

  it("running it on the current tree is a no-op — it agrees with the gate", () => {
    // Behaviour, not source: if the regenerator and the gate disagreed about
    // what counts as empty, this would rewrite the file and the diff would be
    // dirty. Runs the real script the workflow runs.
    const before = readFileSync(resolve(APP, "config/thin-prerender-baseline.json"), "utf8");
    const out = execFileSync("node", ["scripts/update-thin-prerender-baseline.mjs"], {
      cwd: APP,
      encoding: "utf8",
    });
    const after = readFileSync(resolve(APP, "config/thin-prerender-baseline.json"), "utf8");
    expect(out).toMatch(/unchanged at \d+/);
    expect(after, "the regenerator rewrote the baseline it should agree with").toBe(before);
  });
});
