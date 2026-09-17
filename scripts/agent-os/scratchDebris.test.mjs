/**
 * Scratch artifacts may be created freely. They may not be COMMITTED.
 *
 * WHY THIS EXISTS, and it is earned rather than theoretical. The overnight run
 * that produced statenour W12 (#2381-#2384) created roughly ten throwaway probe
 * scripts under `scripts/_tmp-*.ts` — live production reads answering questions
 * the repo could not. Every one was the right thing to write, and every one was
 * deleted by hand afterwards.
 *
 * By hand is the problem. Nothing would have caught the one that was forgotten.
 * A surviving probe is worse than clutter: an executable file with production
 * credentials in its import graph, named as if it were part of the app, covered
 * by no test and indistinguishable from a real script.
 *
 * WHY IT LIVES HERE AND NOT IN A PACKAGE'S SUITE. It shipped first as
 * `apps/statenour/tests/repo/no-committed-scratch-debris.test.ts` and review
 * (#2386, P2) correctly refused it: the scan claims the whole repo, but a
 * package-scoped vitest suite only runs when that package is affected.
 * `.github/workflows/test.yml` gates the `node` job on a path list that does NOT
 * include root `scripts/`, and its `turbo run test --affected` selects only the
 * affected package — so debris committed under `scripts/`, `apps/worker/` or
 * `apps/nickstire/` would never have run the guard that claimed to cover it.
 *
 * A control that cannot see its subject is the exact defect class that run spent
 * the night removing, reproduced inside the guard written against it. The
 * agent-policy workflow runs on EVERY PR with no path filter, which is the only
 * placement where the repo-root claim is true.
 *
 * WHAT THIS IS NOT. It does not police the working tree. Temporary files during
 * a session are the point — the rule is that a slice does not ship with them.
 * It scans TRACKED files only, so a local `_tmp-probe.ts` sitting uncommitted is
 * entirely fine.
 *
 * SCOPE, deliberately narrow. Only shapes that are unambiguous debris: `_tmp*`,
 * `.bak`, `.orig`, `.rej`. Measured 2026-09-17: ZERO tracked files in the
 * monorepo match, so this ships green with no allowlist and no ratchet baseline
 * — a floor, not a cleanup project.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

/** Unambiguous debris. Each shape is something a tool or an agent leaves behind. */
const DEBRIS = [
  { pattern: /(^|\/)_tmp/, label: "_tmp* — throwaway probe or scratch script" },
  { pattern: /\.bak$/, label: ".bak — a backup copy taken before an edit" },
  { pattern: /\.orig$/, label: ".orig — a merge/patch original" },
  { pattern: /\.rej$/, label: ".rej — a rejected patch hunk" },
];

/**
 * Designated scratch areas, which are decisions rather than accidents.
 * Every entry needs a reason; an unexplained exclusion is how a guard rots.
 */
const ALLOWED_PREFIXES = [
  {
    prefix: "apps/nickstire/scratch/",
    reason:
      "A designated scratch directory in a different product, ~45 tracked files, deliberate. " +
      "Debris is an accident; a named scratch area is a decision.",
  },
];

function trackedFiles() {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function offendersIn(files) {
  const out = [];
  for (const f of files) {
    if (ALLOWED_PREFIXES.some((a) => f.startsWith(a.prefix))) continue;
    const hit = DEBRIS.find((d) => d.pattern.test(f));
    if (hit) out.push(`${f}  — ${hit.label}`);
  }
  return out;
}

test("POSITIVE CONTROL: the scanner sees a planted file of EVERY debris shape", () => {
  // Without this, a broken pattern list or an empty file list reports a clean
  // repo forever. Every shape is proven to fire, not just one — a dead rule is
  // caught by name rather than hidden behind a sibling that still works.
  const planted = [
    "scripts/_tmp-probe.ts",
    "apps/statenour/lib/thing.ts.bak",
    "some/file.orig",
    "some/file.rej",
  ];
  const caught = offendersIn(planted);
  assert.equal(caught.length, planted.length);
  for (const shape of DEBRIS) {
    assert.ok(
      caught.some((c) => c.endsWith(shape.label)),
      `the ${shape.label} rule never fired — that pattern is dead`,
    );
  }
});

test("POSITIVE CONTROL: it does not fire on ordinary source files", () => {
  // A rule that flags everything is as useless as one that flags nothing. The
  // last two exercise the ANCHOR: the rule is `_tmp` at a path boundary, not
  // "tmp" anywhere, and an unanchored match would condemn both.
  assert.deepEqual(
    offendersIn([
      "apps/statenour/lib/ai/chat-mode.ts",
      "scripts/agent-os/verify.mjs",
      "apps/statenour/lib/utils/tmpdir-helper.ts",
      "apps/statenour/lib/services/otmp-adapter.ts",
    ]),
    [],
  );
});

test("the scan has a real subject — git ls-files is not returning nothing", () => {
  // Guards the case where git fails, the cwd is wrong, or this is not a
  // checkout: an empty list would make the assertion below vacuous.
  assert.ok(trackedFiles().length > 500);
});

test("REPO-WIDE: no tracked file is scratch debris", () => {
  const offenders = offendersIn(trackedFiles());
  assert.deepEqual(
    offenders,
    [],
    `Committed scratch debris. Promote it into a maintained asset or delete it:\n  ${offenders.join("\n  ")}`,
  );
});

test("the scan actually reaches beyond this package", () => {
  // The whole point of the move. If the roster ever collapses to one app's
  // files, the repo-root claim in the header becomes false and this fails.
  const files = trackedFiles();
  const roots = new Set(files.map((f) => f.split("/")[0]));
  assert.ok(roots.has("apps"), "no apps/ in the roster");
  assert.ok(roots.has("scripts"), "no root scripts/ in the roster — the exact gap review found");
  assert.ok(roots.size > 3, `roster covers only ${[...roots].join(", ")}`);
});

test("every allowlist entry carries a reason and still matches something", () => {
  // An exclusion that no longer applies is an invitation to hide a new mess
  // behind it. If that scratch dir is ever cleaned up, this fails and the entry
  // gets deleted rather than quietly widening the guard's blind spot.
  const files = trackedFiles();
  for (const a of ALLOWED_PREFIXES) {
    assert.ok(a.reason.length > 30, `${a.prefix} has no reason`);
    assert.ok(
      files.some((f) => f.startsWith(a.prefix)),
      `${a.prefix} matches nothing any more — delete the entry instead of leaving a hole`,
    );
  }
});
