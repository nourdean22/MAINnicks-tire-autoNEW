/**
 * Canary: merge-gate.mjs and ledger-check.mjs run when launched through a symlink or a junction (2026-10-15).
 *
 * Both gates first guarded main with `resolve(process.argv[1]) === fileURLToPath(import.meta.url)`. Node resolves the
 * module URL through links while argv[1] stays the link path, so launched through a junction (the worktree layout in this
 * repo) the comparison was false and the gate exited 0 having done nothing. For a merge gate that is a green that never
 * ran. `isMainModule` follows the link; this test launches each gate through one and asserts the gate DID its job: usage
 * error 64, ledger error 1, not a silent 0.
 *
 * The link points at a COPY of the scripts in a temp dir, never at the repo, so removing it cannot reach anything real.
 *
 * Run: node --test scripts/agent-os/gateLaunch.test.mjs   (pnpm agent:verify discovers it)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "gate launch "));
const real = join(root, "real");
const link = join(root, "link");
mkdirSync(real);
for (const f of ["merge-gate.mjs", "ledger-check.mjs", "cli-common.mjs"]) copyFileSync(join(HERE, f), join(real, f));
symlinkSync(real, link, "junction");
after(() => {
  try {
    rmdirSync(link); // a junction is removed as a directory entry; the copy is then removed on its own
  } catch {
    unlinkSync(link);
  }
  rmSync(root, { recursive: true, force: true });
});

const launch = (script, args) => spawnSync(process.execPath, [join(link, script), ...args], { encoding: "utf8", env: { ...process.env, GH_TOKEN: "", GITHUB_TOKEN: "" } });

test("merge-gate launched through a link still runs: bad usage is exit 64 with a usage line, not a silent 0", () => {
  const r = launch("merge-gate.mjs", ["notanumber"]);
  assert.equal(r.status, 64, r.stdout + r.stderr);
  assert.match(r.stderr, /usage: node scripts\/agent-os\/merge-gate\.mjs/);
});

test("ledger-check launched through a link still runs: a stale pending row is exit 1 and is named", () => {
  const bad = join(root, "bad.md");
  writeFileSync(
    bad,
    [
      "Status: MERGED | BLOCKED",
      "",
      "| Job id | Date | Job | Lanes | Status | PR / SHA | Next action or blocker | Lesson |",
      "|---|---|---|---|---|---|---|---|",
      "| 2026-10-15-bad-row | 2026-10-15 | a job | platform | MERGED | pending (x) | none | none |",
      "",
    ].join("\n"),
  );
  const r = launch("ledger-check.mjs", ["--file", bad]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /PR \/ SHA cell says "pending"/);
});

test("control: the same two commands launched by their real path behave the same", () => {
  assert.equal(spawnSync(process.execPath, [join(real, "merge-gate.mjs"), "notanumber"], { encoding: "utf8" }).status, 64);
});
