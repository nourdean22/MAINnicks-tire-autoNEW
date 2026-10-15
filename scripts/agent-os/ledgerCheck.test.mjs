/**
 * Canary for scripts/agent-os/ledger-check.mjs (2026-10-15).
 *
 * Shape (positive-control-first): the checker is proven on throwaway ledgers first (a clean one reads clean, each
 * single defect is named by its own message), then pointed at the real ledger. Against main before this change the
 * real-ledger test was red for the right reason: row 2026-10-15-compiler-provenance-hardening said
 * `pending (chore/compiler-provenance-hardening)` after #3044 had merged.
 *
 * Run: node --test scripts/agent-os/ledgerCheck.test.mjs   (pnpm agent:verify discovers it)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { ledgerProblems } from "./ledger-check.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = fileURLToPath(new URL("./ledger-check.mjs", import.meta.url));
const REAL = join(REPO, "docs", "agent-os", "MANAGER-LEDGER.md");
const tmp = mkdtempSync(join(tmpdir(), "ledger-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const HEAD = [
  "# Manager ledger",
  "",
  "Status: PLANNED | RUNNING | BLOCKED | BUILT | MERGED | LIVE-VERIFIED | CANCELLED",
  "",
  "| Job id | Date | Job | Lanes | Status | PR / SHA | Next action or blocker | Lesson |",
  "|---|---|---|---|---|---|---|---|",
];
const row = (over = {}) => {
  const c = { id: "2026-10-15-good-job", date: "2026-10-15", job: "a job", lanes: "platform", status: "MERGED", pr: "#3000 (abc1234)", next: "none", lesson: "a lesson", ...over };
  return `| ${c.id} | ${c.date} | ${c.job} | ${c.lanes} | ${c.status} | ${c.pr} | ${c.next} | ${c.lesson} |`;
};
const ledger = (...rows) => [...HEAD, ...rows, ""].join("\n");

test("control: a clean ledger reads clean, with and without CRLF", () => {
  const text = ledger(row(), row({ id: "2026-10-15-second", status: "MERGED", pr: "this PR" }), row({ id: "2026-10-15-third", status: "BLOCKED", pr: "none" }));
  assert.deepEqual(ledgerProblems(text), { errors: [], warnings: [], rows: 3 });
  assert.deepEqual(ledgerProblems(text.replace(/\n/g, "\r\n")).errors, []);
});

for (const [label, over, want] of [
  ["pending in the PR cell of a MERGED row", { status: "MERGED", pr: "pending (chore/some-branch)" }, /PR \/ SHA cell says "pending"/],
  ["pending in the PR cell of a BUILT row", { status: "BUILT", pr: "Pending" }, /says "Pending"/],
  ["TBD in the PR cell", { pr: "TBD" }, /says "TBD"/],
  ["an unknown status", { status: "DONE" }, /status "DONE" is not one of/],
  ["a malformed job id", { id: "job-without-a-date" }, /job id must be yyyy-mm-dd-slug/],
]) {
  test(`names ${label}, and only that row`, () => {
    const { errors } = ledgerProblems(ledger(row({ id: "2026-10-15-fine-row" }), row({ id: "2026-10-15-bad-row", ...over })));
    assert.equal(errors.length, 1, JSON.stringify(errors));
    assert.match(errors[0], want);
    assert.ok(errors[0].startsWith(over.id ?? "2026-10-15-bad-row"), errors[0]);
  });
}

test("names a row with a stray pipe inside a cell, and a duplicate job id", () => {
  const stray = ledgerProblems(ledger(row({ lesson: "a | b" }))).errors;
  assert.equal(stray.length, 1);
  assert.match(stray[0], /9 cells, expected 8/);
  const dup = ledgerProblems(ledger(row(), row())).errors;
  assert.equal(dup.length, 1);
  assert.match(dup[0], /duplicate job id/);
});

test("pending outside the PR cell is not an error (a next-action cell may say it)", () => {
  assert.deepEqual(ledgerProblems(ledger(row({ next: "pending the operator's review" }))).errors, []);
});

test("warns, without failing, on an open status that says 'this PR'", () => {
  const r = ledgerProblems(ledger(row({ status: "BUILT", pr: "this PR" })));
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /BUILT with "this PR".*write MERGED/);
});

test("an indented job row is still parsed: a stale pending in it is an error, not silence", () => {
  const r = ledgerProblems(ledger("  " + row({ pr: "pending (x)" })));
  assert.equal(r.rows, 1);
  assert.match(r.errors.join("\n"), /says "pending"/);
});

test("a table-shaped job line the parser cannot read is reported instead of skipped", () => {
  const { errors } = ledgerProblems(ledger("see: " + row()));
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /looks like a job row but does not start with "\|": not parsed/);
});

test("a ledger with no Status line cannot be judged and says so", () => {
  const { errors } = ledgerProblems(ledger(row()).replace(/^Status:.*$/m, ""));
  assert.ok(errors.some((e) => /allowed statuses cannot be read/.test(e)), JSON.stringify(errors));
});

test("the CLI exits 1 on an error and 0 on a clean ledger, and prints the row", () => {
  const bad = join(tmp, "bad.md");
  writeFileSync(bad, ledger(row({ pr: "pending (x)" })));
  const r = spawnSync(process.execPath, [SCRIPT, "--file", bad], { encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /ERROR  2026-10-15-good-job: PR \/ SHA cell says "pending"/);
  const good = join(tmp, "good.md");
  writeFileSync(good, ledger(row()));
  assert.equal(spawnSync(process.execPath, [SCRIPT, "--file", good], { encoding: "utf8" }).status, 0);
});

test("the real ledger is clean: no job keeps `pending` in its PR cell", (t) => {
  const { errors, warnings, rows } = ledgerProblems(readFileSync(REAL, "utf8"));
  t.diagnostic(`checked ${rows} rows, ${warnings.length} warning(s)`);
  const text = readFileSync(REAL, "utf8");
  const jobLines = (text.match(/^\s*\|\s*\d{4}-\d{2}-\d{2}-/gm) ?? []).length;
  assert.equal(rows, jobLines, `the parser read ${rows} rows but the file has ${jobLines} job-id lines: a row was skipped`);
  assert.ok(rows > 20, `only ${rows} rows were read: the parser lost the table`);
  assert.deepEqual(errors, [], `\n${errors.join("\n")}`);
});
