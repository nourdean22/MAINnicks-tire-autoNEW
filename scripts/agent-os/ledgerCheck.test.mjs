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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { ledgerProblems, ledgerRootProblems, loadJobs, renderLedger } from "./ledger-check.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = fileURLToPath(new URL("./ledger-check.mjs", import.meta.url));
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

for (const [label, below] of [
  ["a job row behind a prefix", "see: " + row({ id: "2026-10-15-stray" })],
  ["a blockquoted job row", "> " + row({ id: "2026-10-15-stray" })],
  ["a bulleted job row", "- " + row({ id: "2026-10-15-stray" })],
  ["a job row after a blank line (the table ended above it)", "\n" + row({ id: "2026-10-15-stray" })],
]) {
  test(`${label} below the table is reported instead of skipped`, () => {
    const { errors } = ledgerProblems(ledger(row(), below));
    assert.equal(errors.length, 1, JSON.stringify(errors));
    assert.match(errors[0], /2026-10-15-stray.*below the table.*not parsed/);
  });
}

test("prose above the table is ignored, including an indented example row and an inline-code mention of a row", () => {
  const prose = ["Each Job id is yyyy-mm-dd-slug, and the Job id column is the key.", "Rows look like:", "", "    " + row({ id: "2026-10-15-example" }), "", "Write `| 2026-10-15-example | ... |` in the PR that merges.", ""];
  const text = [...HEAD.slice(0, 2), ...prose, ...HEAD.slice(2), row(), ""].join("\n");
  assert.deepEqual(ledgerProblems(text), { errors: [], warnings: [], rows: 1 });
});

test("the table is found by its header, not by its position, and a missing header or separator is an error", () => {
  assert.match(ledgerProblems(ledger(row()).replace(/^\| Job id.*$/m, "")).errors.join("\n"), /no `\| Job id \| \.\.\.` header/);
  assert.match(ledgerProblems(ledger(row()).replace(/^\|---.*$/m, "")).errors.join("\n"), /separator/);
});

test("a header with no rows under it is an error, not a clean empty ledger", () => {
  const { errors, rows } = ledgerProblems(ledger());
  assert.equal(rows, 0);
  assert.match(errors.join("\n"), /header but no rows/);
});

for (const [label, pr] of [["TODO", "TODO"], ["todo in a sentence", "todo: fill in"], ["an empty cell", ""], ["only spaces", "   "]]) {
  test(`${label} in the PR cell is an error`, () => {
    const { errors } = ledgerProblems(ledger(row({ pr })));
    assert.equal(errors.length, 1, JSON.stringify(errors));
    assert.match(errors[0], /PR \/ SHA cell/);
  });
}

for (const status of ["PLANNED", "RUNNING", "BUILT"]) {
  test(`warns, without failing, on ${status} whose PR cell says MERGED`, () => {
    const r = ledgerProblems(ledger(row({ status, pr: "#3012 MERGED (squash b31e6267)" })));
    assert.deepEqual(r.errors, []);
    assert.equal(r.warnings.length, 1, JSON.stringify(r.warnings));
    assert.match(r.warnings[0], new RegExp(`${status}.*says MERGED.*update the status`));
  });
}

test("a MERGED row that mentions a merged PR raises no warning, and a lowercase 'merged' in an open row is prose", () => {
  assert.deepEqual(ledgerProblems(ledger(row({ pr: "#3012 MERGED (squash)" }))).warnings, []);
  assert.deepEqual(ledgerProblems(ledger(row({ status: "RUNNING", pr: "#3012 (not merged yet)" }))).warnings, []);
});

test("a tab-indented job row is parsed like any other", () => {
  const r = ledgerProblems(ledger("\t" + row({ pr: "pending (x)" })));
  assert.equal(r.rows, 1);
  assert.match(r.errors.join("\n"), /says "pending"/);
});

test("an unreadable file exits 2 with one line, not a stack trace", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--file", join(tmp, "does-not-exist.md")], { encoding: "utf8" });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /ledger-check: cannot read .*does-not-exist\.md/);
  assert.doesNotMatch(r.stderr, /at .*node:internal/);
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

test("the real ledger is clean: no job keeps `pending` in its PR cell (read from the per-job files, the way the CLI reads them)", (t) => {
  const { errors, warnings, rows } = ledgerRootProblems(REPO);
  t.diagnostic(`checked ${rows} rows, ${warnings.length} warning(s)`);
  const text = renderLedger(REPO);
  const jobLines = (text.match(/^\s*\|\s*\d{4}-\d{2}-\d{2}-/gm) ?? []).length;
  assert.equal(rows, jobLines, `the parser read ${rows} rows but the view has ${jobLines} job-id lines: a row was skipped`);
  assert.equal(rows, loadJobs(REPO).jobs.length, "a job file did not become a row");
  assert.ok(rows > 20, `only ${rows} rows were read: the parser lost the table`);
  assert.deepEqual(errors, [], `\n${errors.join("\n")}`);
});

test("the planted bad row of the old real-ledger canary, pointed at a per-job file: the CLI names the file's row and exits 1", () => {
  // the shared-table canaries above plant a bad row in a throwaway ledger text; this one plants it where rows now live
  const root = join(tmp, "root");
  mkdirSync(join(root, "docs", "agent-os", "ledger"), { recursive: true });
  writeFileSync(join(root, "docs", "agent-os", "MANAGER-LEDGER.md"), "# Manager ledger\n\nStatus: PLANNED | RUNNING | BLOCKED | BUILT | MERGED | LIVE-VERIFIED | CANCELLED\n");
  writeFileSync(join(root, "docs", "agent-os", "MANAGER-METRICS.md"), "# Manager job metrics\n");
  const id = "2026-10-15-compiler-provenance-hardening"; // the row that was `pending (...)` on main after #3044 merged
  writeFileSync(join(root, "docs", "agent-os", "ledger", `${id}.md`), [...HEAD.slice(4), row({ id, pr: "pending (chore/compiler-provenance-hardening)" }), ""].join("\n"));
  const r = spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /ERROR  2026-10-15-compiler-provenance-hardening: PR \/ SHA cell says "pending"/);
});
