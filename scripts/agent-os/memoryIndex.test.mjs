/**
 * Canaries for the agent-memory index guard (check-memory-index.mjs).
 *
 * Auto-discovered by verify.mjs, so this file is also the wiring for the GUARD's
 * correctness — though not for the guard's *execution* against the real index,
 * which is impossible here and is the point below.
 *
 * FIXTURES ONLY, NEVER THE REAL INDEX. The memory directory is machine-local
 * (`~/.claude/projects/<slug>/memory/`) and exists on no CI runner. A test that
 * pointed at the default path would pass on the author's laptop and silently
 * skip — or bail — in CI, which is precisely the local-vs-CI divergence that
 * has already bitten the doc-claim canaries three times in one session (707 vs
 * 722 files, an uncommitted sibling fix, and a missing git identity).
 *
 * So: every case below builds a throwaway directory and passes `--dir`. What
 * these canaries prove is that the guard's LOGIC is correct. What they cannot
 * prove is that the guard ever RUNS against the operator's real index — that
 * requires the SessionStart hook, and until it is installed this guard is an
 * unwired control. Stated here rather than left implicit, because a passing
 * test suite around an uninvoked guard is exactly shape 1.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = join(ROOT, "scripts", "agent-os", "check-memory-index.mjs");
const SENTINEL = "<!-- INDEX-END -->";

/** Build a scratch memory dir from {index, files} and run the guard on it. */
function run({ index, files = {} }, extraArgs = []) {
  const dir = mkdtempSync(join(tmpdir(), "memory-index-"));
  try {
    writeFileSync(join(dir, "MEMORY.md"), index);
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    const r = spawnSync(process.execPath, [GUARD, "--dir", dir, ...extraArgs], { encoding: "utf8" });
    return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const healthy = {
  index: `# Memory index\n\n- [alpha](alpha.md) - a\n- [beta](beta.md) - b\n${SENTINEL}\n`,
  files: { "alpha.md": "a\n", "beta.md": "b\n" },
};

test("a healthy index passes", () => {
  const { code, out } = run(healthy);
  assert.equal(code, 0, `healthy fixture failed:\n${out}`);
  assert.match(out, /all reachable, sentinel present/);
});

test("BREAKS: a missing sentinel fails", () => {
  const { code, out } = run({ ...healthy, index: healthy.index.replace(SENTINEL + "\n", "") });
  assert.equal(code, 1, `no sentinel did not fail:\n${out}`);
  assert.match(out, /sentinel is not the last thing/);
});

test("BREAKS: entries appended AFTER the sentinel fail", () => {
  // Subtle and the reason the check is "last line", not "contains". A sentinel
  // that is present but no longer terminal cannot prove a complete read: the
  // reader may have stopped after it, with later entries unseen.
  const { code, out } = run({ ...healthy, index: healthy.index + "- [gamma](gamma.md) - c\n",
    files: { ...healthy.files, "gamma.md": "c\n" } });
  assert.equal(code, 1, `a non-terminal sentinel did not fail:\n${out}`);
  assert.match(out, /sentinel is not the last thing/);
});

test("BREAKS: an unrelated trailing comment does NOT pass as the sentinel", () => {
  // Raised in review. The first draft accepted any trailing `-->`, so deleting
  // INDEX-END and leaving any other comment last printed "sentinel present" --
  // a truncation check a stray comment satisfies, inside the guard against
  // exactly that. Distinct from the missing-sentinel case: there the file ends
  // with prose, here it ends with a well-formed comment that is the WRONG one.
  const { code, out } = run({
    ...healthy,
    index: healthy.index.replace(SENTINEL, "<!-- unrelated trailing note -->"),
  });
  assert.equal(code, 1, `a decoy trailing comment passed as the sentinel: ${out}`);
  assert.match(out, /sentinel is not the last thing/);
});

test("a MULTILINE sentinel still passes", () => {
  // The real index uses a multiline sentinel whose last line ends the comment
  // without repeating the marker. The fix must not break it -- that is why the
  // loose `-->` alternative existed in the first place.
  const multi = [
    "<!-- INDEX-END. If you cannot see this line the index truncated.",
    "     Move old entries to settled-index.md past 80%. -->",
  ].join("\n");
  const { code, out } = run({ ...healthy, index: healthy.index.replace(SENTINEL, multi) });
  assert.equal(code, 0, `the multiline sentinel was rejected: ${out}`);
});

test("--quiet suppresses the healthy line but NEVER the capacity warning", () => {
  // Raised in review: the documented SessionStart install uses --quiet, and the
  // first draft gated the 80% warning on it too -- so the operator would first
  // hear about capacity when the guard FAILED at 92%. An early-warning system
  // that only speaks once it is too late, inside the guard written against that.
  const filler = "- [x](alpha.md) - " + "y".repeat(200) + "\n";
  const warnIndex = "# Memory index\n\n" + filler.repeat(98) + SENTINEL + "\n";
  // files scoped to alpha.md only: the filler references alpha, so carrying
  // healthy's beta.md would orphan it and fail this test for an unrelated
  // reason — a fixture defect masquerading as a guard defect.
  const quiet = run({ index: warnIndex, files: { "alpha.md": "a\n" } }, ["--quiet"]);
  assert.equal(quiet.code, 0, `warn-band fixture should still exit 0: ${quiet.out}`);
  assert.match(quiet.out, /WARNING/, "--quiet must not swallow the capacity warning");
  assert.doesNotMatch(quiet.out, /all reachable, sentinel present/, "--quiet must suppress the healthy line");
});

test("BREAKS: a memory reachable from no index fails", () => {
  const { code, out } = run({ ...healthy, files: { ...healthy.files, "orphan.md": "x\n" } });
  assert.equal(code, 1, `an orphaned memory did not fail:\n${out}`);
  assert.match(out, /referenced by NO index/);
  assert.match(out, /orphan\.md/);
});

test("a memory reachable only via the SECOND-level index passes", () => {
  // The two-level split is the sanctioned structure — 66 of the real index's
  // files live behind settled-index.md. A guard that ignored the second level
  // would report 66 false orphans and be discarded as noise within a day.
  const { code, out } = run({
    ...healthy,
    files: {
      ...healthy.files,
      "settled-index.md": "- [old](old.md) - archived\n",
      "old.md": "o\n",
    },
  });
  assert.equal(code, 0, `second-level reachability not honoured:\n${out}`);
});

test("BREAKS: past the fail threshold it fails, and names the right remedy", () => {
  const filler = "- [x](alpha.md) - " + "y".repeat(200) + "\n";
  const { code, out } = run({ ...healthy, index: `# Memory index\n\n${filler.repeat(120)}${SENTINEL}\n` });
  assert.equal(code, 1, `an oversized index did not fail:\n${out}`);
  assert.match(out, /% of the ~24400-byte read limit/);
  // The remedy matters as much as the alarm: compaction has been spent twice
  // and buys weeks; the migration buys years.
  assert.match(out, /settled-index\.md/);
  assert.match(out, /do not compact/i);
});

test("BREAKS: a guard that cannot see its subject exits 2, never 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "memory-index-gone-"));
  rmSync(dir, { recursive: true, force: true });
  const r = spawnSync(process.execPath, [GUARD, "--dir", dir], { encoding: "utf8" });
  assert.equal(r.status, 2, "a missing directory must exit 2");
  assert.notEqual(r.status, 0, "failing OPEN here would print the same green as a healthy index");
  assert.match((r.stdout ?? "") + (r.stderr ?? ""), /CANNOT CHECK/);
});
