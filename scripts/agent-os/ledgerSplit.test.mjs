/**
 * Canary for the per-job ledger split (2026-10-16, CI diet PR 2).
 *
 * Before: every PR appended one row to the tail of docs/agent-os/MANAGER-LEDGER.md and one to MANAGER-METRICS.md, so two PRs
 * in flight conflicted at the same line and the loser pushed again (about 2.5 pushes per PR on 2026-10-15/16). Now each job
 * owns docs/agent-os/ledger/<job-id>.md (a one-row ledger table, optionally a one-row metrics table, nothing else). The two
 * old files hold prose only; the tables are rendered on demand by ledger-render.mjs and checked by ledger-check.mjs.
 *
 * Positive-control-first: this file was written before the code and was red on the unsplit tree (shape recorded in the PR).
 * It proves, with the real git binary, that two PRs adding a job file merge cleanly, and that the OLD layout conflicts in the
 * same harness (the control that shows the instrument can fail). Every structural rule has a planted bad file that must be
 * named; the existing ledger-check rules keep their own canaries in ledgerCheck.test.mjs and are exercised here through files.
 *
 * Run: node --test scripts/agent-os/ledgerSplit.test.mjs   (pnpm agent:verify discovers it)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { stripGitLocalEnv } from "./gitLocalEnv.mjs";

// Dynamic import so a missing export fails each test by name instead of failing the whole file at load.
const L = await import("./ledger-check.mjs");

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const CHECK = fileURLToPath(new URL("./ledger-check.mjs", import.meta.url));
const RENDER = fileURLToPath(new URL("./ledger-render.mjs", import.meta.url));
const MIGRATE = fileURLToPath(new URL("./ledger-migrate.mjs", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "ledger-split-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

// The headers as they stood in the unsplit files. Pinned as literals here so a header edit in the code cannot silently
// change what the migrated rows mean.
const LEGACY_LEDGER_HEAD = [
  "| Job id | Date | Job | Lanes | Status | PR / SHA | Next action or blocker | Lesson |",
  "|---|---|---|---|---|---|---|---|",
];
const LEGACY_METRICS_HEAD = [
  "| Job id | After the PR opened (Codex, human) | Manager catches before it opened | Red-first (new tests red on unfixed code / new tests) | Mutation (killed / tried) | Cycle time (first dispatch to merge) | Rework pushes | Source |",
  "|---|---|---|---|---|---|---|---|",
];
const STUB_L = "# Manager ledger\n\nStatus: PLANNED | RUNNING | BLOCKED | BUILT | MERGED | LIVE-VERIFIED | CANCELLED\n";
const STUB_M = "# Manager job metrics\n\nClasses for findings: bypass, test-gap, doc-claim, scope, name-or-fact, other.\n";

const lrow = (id, o = {}) => {
  const c = { date: id.slice(0, 10), job: "a job", lanes: "platform", status: "MERGED", pr: "this PR", next: "none", lesson: "a lesson", ...o };
  return `| ${id} | ${c.date} | ${c.job} | ${c.lanes} | ${c.status} | ${c.pr} | ${c.next} | ${c.lesson} |`;
};
const mrow = (id, tail = "UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | this PR") => `| ${id} | ${tail} |`;
const jobText = (id, { ledger = lrow(id), metrics = mrow(id) } = {}) =>
  [...LEGACY_LEDGER_HEAD, ledger, ...(metrics === null ? [] : ["", ...LEGACY_METRICS_HEAD, metrics]), ""].join("\n");

let n = 0;
/** A scratch repo root: stubs plus the given job files ({name: text}). */
function makeRoot(files, { stubL = STUB_L, stubM = STUB_M } = {}) {
  const root = join(tmp, `root${n++}`);
  mkdirSync(join(root, "docs", "agent-os", "ledger"), { recursive: true });
  if (stubL !== null) writeFileSync(join(root, "docs", "agent-os", "MANAGER-LEDGER.md"), stubL);
  if (stubM !== null) writeFileSync(join(root, "docs", "agent-os", "MANAGER-METRICS.md"), stubM);
  for (const [name, text] of Object.entries(files)) {
    if (text === null) mkdirSync(join(root, "docs", "agent-os", "ledger", name));
    else writeFileSync(join(root, "docs", "agent-os", "ledger", name), text);
  }
  return root;
}
const good = (id) => ({ [`${id}.md`]: jobText(id) });
const A = "2026-10-15-job-a";
const B = "2026-10-16-job-b";
const C = "2026-10-16-job-c";
const cli = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", cwd });

test("the canonical headers are the unsplit files' headers, byte for byte", () => {
  assert.deepEqual(L.LEDGER_HEAD, LEGACY_LEDGER_HEAD);
  assert.deepEqual(L.METRICS_HEAD, LEGACY_METRICS_HEAD);
});

test("control: a clean root reads clean, with the job files written in either order", () => {
  const one = makeRoot({ ...good(A), ...good(B), ...good(C) });
  const two = makeRoot({ ...good(C), ...good(B), ...good(A) });
  const r1 = L.ledgerRootProblems(one);
  assert.deepEqual(r1, { errors: [], warnings: [], rows: 3 });
  assert.deepEqual(L.ledgerRootProblems(two), r1);
  assert.equal(L.renderLedger(one), L.renderLedger(two));
  assert.equal(L.renderMetrics(one), L.renderMetrics(two));
});

test("jobs come back in job id order whatever order the filesystem lists them in (a listing is the filesystem's order, not the repo's)", () => {
  const root = makeRoot({ ...good(C), ...good(A), ...good(B) });
  const listed = readdirSync(join(root, "docs", "agent-os", "ledger"), { withFileTypes: true });
  for (const entries of [listed, [...listed].reverse(), [listed[1], listed[2], listed[0]]]) {
    assert.deepEqual(L.loadJobs(root, entries).jobs.map((j) => j.id), [A, B, C]);
  }
});

test("render: the stub prose, the canonical header, then the rows sorted by job id; the metrics view holds only jobs that have a metrics row", () => {
  const root = makeRoot({ ...good(C), [`${A}.md`]: jobText(A, { metrics: null }), ...good(B) });
  assert.equal(L.renderLedger(root), `${STUB_L}\n${LEGACY_LEDGER_HEAD.join("\n")}\n${[lrow(A), lrow(B), lrow(C)].join("\n")}\n`);
  assert.equal(L.renderMetrics(root), `${STUB_M}\n${LEGACY_METRICS_HEAD.join("\n")}\n${[mrow(B), mrow(C)].join("\n")}\n`);
});

// Every rule below plants ONE bad file next to a good one; the bad file is named, the good one is not.
for (const [label, name, text, want] of [
  ["pending in the PR cell (the existing rule, read through a file)", `${A}.md`, jobText(A, { ledger: lrow(A, { pr: "pending (x)" }) }), /says "pending"/],
  ["a stray pipe in a ledger cell", `${A}.md`, jobText(A, { ledger: lrow(A, { lesson: "a | b" }) }), /9 cells, expected 8/],
  ["an unknown status", `${A}.md`, jobText(A, { ledger: lrow(A, { status: "DONE" }) }), /status "DONE" is not one of/],
  ["an empty PR cell", `${A}.md`, jobText(A, { ledger: lrow(A, { pr: "" }) }), /PR \/ SHA cell is empty/],
  ["a conflict marker: ours", `${A}.md`, jobText(A) + "<<<<<<< HEAD\n", /conflict marker on line \d+/],
  ["a conflict marker: separator", `${A}.md`, jobText(A) + "=======\n", /conflict marker on line \d+/],
  ["a conflict marker: theirs", `${A}.md`, jobText(A) + ">>>>>>> chore/other\n", /conflict marker on line \d+/],
  ["a conflict marker: diff3 base", `${A}.md`, jobText(A) + "||||||| merged common ancestors\n", /conflict marker on line \d+/],
  ["a ledger row whose job id is not the file name", `${A}.md`, jobText(A, { ledger: lrow(B), metrics: mrow(A) }), /ledger row is for "2026-10-16-job-b" but the file is 2026-10-15-job-a/],
  ["a file name that is not a job id", "notes.md", jobText(A), /not a job file name/],
  ["a file that is not markdown", `${A}.txt`, jobText(A), /not a job file name/],
  ["a sub-directory", "2026-10-16-job-dir", null, /not a job file/],
  ["prose in a job file", `${A}.md`, jobText(A) + "See the PR for details.\n", /holds the ledger row, then the metrics row, and nothing else/],
  ["two ledger rows in one file", `${A}.md`, [...LEGACY_LEDGER_HEAD, lrow(A), lrow(A, { job: "again" }), ""].join("\n"), /holds the ledger row, then the metrics row, and nothing else/],
  ["a drifted ledger header", `${A}.md`, jobText(A).replace("| Lesson |", "| Lessons |"), /ledger table must start with the canonical header/],
  ["a missing ledger header", `${A}.md`, lrow(A) + "\n", /ledger table must start with the canonical header/],
  ["an empty file", `${A}.md`, "", /ledger table must start with the canonical header/],
  ["a drifted metrics header", `${A}.md`, jobText(A).replace("| Source |", "| Sources |"), /metrics table must start with the canonical header/],
  ["a metrics row with 7 cells", `${A}.md`, jobText(A, { metrics: mrow(A, "UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN") }), /metrics row has 7 cells, expected 8/],
  ["a metrics row for another job", `${A}.md`, jobText(A, { metrics: mrow(B) }), /metrics row is for "2026-10-16-job-b" but the file is 2026-10-15-job-a/],
]) {
  test(`names ${label}, and only that file`, () => {
    const root = makeRoot({ ...good(B), [name]: text });
    const { errors } = L.ledgerRootProblems(root);
    assert.ok(errors.length >= 1, "a planted defect must be an error");
    assert.ok(errors.some((e) => want.test(e)), `no error matched ${want}: ${JSON.stringify(errors)}`);
    assert.ok(errors.every((e) => !e.includes(B + ".md")), `the good file was blamed: ${JSON.stringify(errors)}`);
    const r = cli(CHECK, ["--root", root]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, want);
  });
}

test("the old tables are prose only: a row left in either stub is an error that says where rows go", () => {
  for (const [stubL, stubM, file] of [
    [STUB_L + "\n" + LEGACY_LEDGER_HEAD.join("\n") + "\n" + lrow(A) + "\n", STUB_M, "MANAGER-LEDGER.md"],
    [STUB_L, STUB_M + "\n" + LEGACY_METRICS_HEAD.join("\n") + "\n", "MANAGER-METRICS.md"],
    [STUB_L, STUB_M + "\n  " + mrow(A) + "\n", "MANAGER-METRICS.md"],
  ]) {
    const { errors } = L.ledgerRootProblems(makeRoot(good(B), { stubL, stubM }));
    assert.equal(errors.length, 1, JSON.stringify(errors));
    assert.match(errors[0], new RegExp(`${file} holds a table line \\(line \\d+\\): rows live one per job in docs/agent-os/ledger/<job-id>\\.md`));
  }
});

test("a conflict marker in a stub is an error", () => {
  const { errors } = L.ledgerRootProblems(makeRoot(good(B), { stubL: STUB_L + "<<<<<<< HEAD\n" }));
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /MANAGER-LEDGER\.md: unresolved merge conflict marker on line \d+/);
});

test("a root with no job files is the existing empty-table error, not a clean empty ledger", () => {
  const { errors, rows } = L.ledgerRootProblems(makeRoot({}));
  assert.equal(rows, 0);
  assert.match(errors.join("\n"), /header but no rows/);
});

test("a missing stub or ledger directory exits 2 with one line, not a stack trace", () => {
  for (const root of [makeRoot(good(A), { stubL: null }), join(tmp, "no-such-root")]) {
    const r = cli(CHECK, ["--root", root]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /^ledger-check: cannot read /m);
    assert.doesNotMatch(r.stderr, /at .*node:internal/);
  }
});

test("the CLI prints the job count and exits 0 on a clean root, with a warning that does not fail it", () => {
  const root = makeRoot({ ...good(A), [`${B}.md`]: jobText(B, { ledger: lrow(B, { status: "BUILT" }) }) });
  const r = cli(CHECK, ["--root", root]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ledger-check: 2 rows, 0 errors, 1 warnings/);
  assert.match(r.stderr, /warn .*BUILT with "this PR"/);
});

// --- the point of the change: two PRs, one merge, no conflict (with the old shape as the control) ---

const gitEnv = () => ({ ...stripGitLocalEnv(process.env), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x.com" });
const git = (cwd, ...args) => spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8", env: gitEnv() });
const ok = (r) => assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);

/** Commit `root` as main, give two branches one edit each (pr-a adds job B, pr-b adds job C), then merge `second` into `first`. */
function twoBranches(root, edit, first, second) {
  ok(git(root, "init", "-q", "-b", "main"));
  ok(git(root, "add", "-A"));
  ok(git(root, "commit", "-q", "-m", "base"));
  for (const [branch, id] of [["pr-a", B], ["pr-b", C]]) {
    ok(git(root, "checkout", "-q", "-b", branch, "main"));
    edit(id);
    ok(git(root, "add", "-A"));
    ok(git(root, "commit", "-q", "-m", branch));
  }
  ok(git(root, "checkout", "-q", first));
  return git(root, "merge", "--no-edit", second);
}

test("two PRs that each add a job file merge with no conflict, and the merged tree passes the check (either merge direction)", () => {
  for (const [first, second] of [["pr-a", "pr-b"], ["pr-b", "pr-a"]]) {
    const root = makeRoot(good(A));
    const merged = twoBranches(root, (id) => writeFileSync(join(root, "docs", "agent-os", "ledger", `${id}.md`), jobText(id)), first, second);
    assert.equal(merged.status, 0, `${merged.stdout}${merged.stderr}`);
    assert.deepEqual(L.ledgerRootProblems(root), { errors: [], warnings: [], rows: 3 });
  }
});

test("control: the unsplit shape (both PRs append a row to one table's tail) DOES conflict in the same harness", () => {
  const root = makeRoot({}, { stubL: [STUB_L, ...LEGACY_LEDGER_HEAD, lrow(A), ""].join("\n") });
  const file = join(root, "docs", "agent-os", "MANAGER-LEDGER.md");
  const merged = twoBranches(root, (id) => writeFileSync(file, readFileSync(file, "utf8") + lrow(id) + "\n"), "pr-a", "pr-b");
  assert.notEqual(merged.status, 0, "the old layout merged cleanly: the harness cannot tell the two layouts apart");
  assert.match(`${merged.stdout}${merged.stderr}`, /CONFLICT/);
});

// --- migration and the round trip ---

const legacyLedger = (...rows) => [STUB_L, ...LEGACY_LEDGER_HEAD, ...rows, ""].join("\n");
const legacyMetrics = (...rows) => [STUB_M, ...LEGACY_METRICS_HEAD, ...rows, ""].join("\n");

test("migrate: every legacy row lands in its own file with its cells unchanged; a job without a metrics row gets none", () => {
  // legacy order is NOT id order (the real ledger had such rows), and the metrics table lists fewer jobs
  const rows = [lrow(B, { lesson: "keeps `code`, ** and \\ and unicode é" }), lrow(A), lrow(C, { next: "a long cell:" + "x".repeat(900) })];
  const files = L.migrateTables(legacyLedger(...rows), legacyMetrics(mrow(C), mrow(B)));
  assert.deepEqual([...files.keys()], [A, B, C].map((id) => id), "files come back in job id order");
  assert.equal(files.get(A), jobText(A, { metrics: null }));
  assert.equal(files.get(B), jobText(B, { ledger: rows[0] }));
  assert.equal(files.get(C), jobText(C, { ledger: rows[2] }));
});

test("round trip: migrate then render gives the legacy rows back, byte for byte per row, as a set; render sorts them by id", () => {
  const rows = [lrow(C), lrow(A), lrow(B, { lesson: "é ü 日本" })];
  const metrics = [mrow(B), mrow(A)];
  const files = L.migrateTables(legacyLedger(...rows), legacyMetrics(...metrics));
  const root = makeRoot(Object.fromEntries([...files].map(([id, t]) => [`${id}.md`, t])));
  const out = L.renderLedger(root).split("\n").filter((l) => l.startsWith("| 20"));
  assert.deepEqual([...out].sort(), [...rows].sort());
  assert.deepEqual(out, [...rows].sort(), "rendered in id order");
  assert.deepEqual(L.renderMetrics(root).split("\n").filter((l) => l.startsWith("| 20")), [...metrics].sort());
  // and the other direction: files -> views -> files is the identity
  const again = L.migrateTables(L.renderLedger(root), L.renderMetrics(root));
  assert.deepEqual([...again], [...files]);
});

test("migrate refuses what it cannot move without loss: a drifted header, a duplicate id, a row with 7 cells, a metrics row with no ledger row", () => {
  const drift = legacyLedger(lrow(A)).replace("| Lesson |", "| Lessons |");
  assert.throws(() => L.migrateTables(drift, null), /header/);
  assert.throws(() => L.migrateTables(legacyLedger(lrow(A), lrow(A)), null), /duplicate job id/);
  assert.throws(() => L.migrateTables(legacyLedger(lrow(A, { lesson: "a | b" })), null), /9 cells, expected 8/);
  assert.throws(() => L.migrateTables(legacyLedger(lrow(A)), legacyMetrics(mrow(B))), /metrics row .* no ledger row/);
});

test("migrate CLI: writes the files, skips existing ones, --only picks one job, --force overwrites", () => {
  const dir = join(tmp, "legacy");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ledger.md"), legacyLedger(lrow(A), lrow(B)));
  writeFileSync(join(dir, "metrics.md"), legacyMetrics(mrow(B)));
  const out = join(tmp, "migrated");
  let r = cli(MIGRATE, ["--ledger", join(dir, "ledger.md"), "--metrics", join(dir, "metrics.md"), "--out", out, "--only", B]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(readdirSync(out), [`${B}.md`]);
  assert.match(r.stdout, /wrote 1, skipped 0/);
  r = cli(MIGRATE, ["--ledger", join(dir, "ledger.md"), "--metrics", join(dir, "metrics.md"), "--out", out]);
  assert.match(r.stdout, /wrote 1, skipped 1/);
  assert.deepEqual(readdirSync(out), [`${A}.md`, `${B}.md`]);
  writeFileSync(join(out, `${A}.md`), "edited\n");
  r = cli(MIGRATE, ["--ledger", join(dir, "ledger.md"), "--out", out, "--force", "--only", A]);
  assert.equal(readFileSync(join(out, `${A}.md`), "utf8"), jobText(A, { metrics: null }));
  r = cli(MIGRATE, ["--ledger", join(dir, "ledger.md"), "--out", join(tmp, "never"), "--only", "2099-01-01-nope"]);
  assert.equal(r.status, 64, "an --only id the table does not hold is an error, never 'wrote 0'");
  assert.match(r.stderr, /not in the ledger table: 2099-01-01-nope/);
  assert.equal(cli(MIGRATE, [], tmp).status, 64, "no arguments is a usage error");
  assert.equal(cli(MIGRATE, ["--ledger", join(dir, "nope.md"), "--out", out]).status, 2, "an unreadable input exits 2");
});

// --- the render CLI manager step 1 uses ---

test("render CLI: full view, --metrics, --open, --tail and their union", () => {
  const root = makeRoot({
    ...good("2026-10-10-old"),
    "2026-10-11-running.md": jobText("2026-10-11-running", { ledger: lrow("2026-10-11-running", { status: "RUNNING", pr: "none" }) }),
    "2026-10-12-blocked.md": jobText("2026-10-12-blocked", { ledger: lrow("2026-10-12-blocked", { status: "BLOCKED", pr: "none" }) }),
    "2026-10-13-live.md": jobText("2026-10-13-live", { ledger: lrow("2026-10-13-live", { status: "LIVE-VERIFIED" }) }),
    ...good("2026-10-14-new"),
  });
  const rowsOf = (args) => cli(RENDER, ["--root", root, ...args]).stdout.split("\n").filter((l) => l.startsWith("| 20")).map((l) => l.split(" | ")[0].slice(2));
  assert.deepEqual(rowsOf([]), ["2026-10-10-old", "2026-10-11-running", "2026-10-12-blocked", "2026-10-13-live", "2026-10-14-new"]);
  assert.deepEqual(rowsOf(["--open"]), ["2026-10-11-running", "2026-10-12-blocked", "2026-10-13-live"], "open = status not MERGED/CANCELLED, the rule manager step 1 states");
  assert.deepEqual(rowsOf(["--tail", "1"]), ["2026-10-14-new"]);
  assert.deepEqual(rowsOf(["--open", "--tail", "1"]), ["2026-10-11-running", "2026-10-12-blocked", "2026-10-13-live", "2026-10-14-new"], "union, in id order, no duplicates");
  assert.deepEqual(rowsOf(["--open", "--tail", "4"]), ["2026-10-11-running", "2026-10-12-blocked", "2026-10-13-live", "2026-10-14-new"]);
  assert.match(cli(RENDER, ["--root", root]).stdout, /^# Manager ledger/);
  assert.match(cli(RENDER, ["--root", root, "--metrics"]).stdout, /^# Manager job metrics/);
  assert.equal(cli(RENDER, ["--root", join(tmp, "no-such-root")]).status, 2);
  for (const bad of ["x", "0", "-1", "1.5"]) assert.equal(cli(RENDER, ["--root", root, "--tail", bad]).status, 64, `--tail ${bad} is a usage error, not 'all rows' or 'no rows'`);
  assert.equal(cli(RENDER, ["--root", root, "--metrics", "--open"]).status, 64, "--open reads Status, which only the ledger has");
});

// --- the readers of the instructions (assert-the-consumer): an agent follows these files, so they must not send a row to the old tables ---

const OLD_INSTRUCTIONS = [
  /\b(?:append|appended|appending)\b[^\n]{0,100}MANAGER-(?:LEDGER|METRICS)/i,
  /\brows?\b[^\n]{0,20}\b(?:in|to|of)\b `?docs\/agent-os\/MANAGER-(?:LEDGER|METRICS)\.md/i,
  /->\s*`docs\/agent-os\/MANAGER-LEDGER\.md`/,
];
const WORDING_BEFORE_THE_SPLIT = [
  "Read EVERY row of `docs/agent-os/MANAGER-LEDGER.md` whose status is not MERGED/CANCELLED, plus the",
  "append the job's row to `docs/agent-os/MANAGER-METRICS.md`. A lesson repeated in an earlier row",
  "one row in `docs/agent-os/MANAGER-LEDGER.md` written as `MERGED` with PR cell `this PR`",
  "plus one row in `docs/agent-os/MANAGER-METRICS.md`, both in the PR that merges.",
  "Job outcome -> `docs/agent-os/MANAGER-LEDGER.md`.",
  "open rows in `docs/agent-os/MANAGER-LEDGER.md` |",
  "its row in `docs/agent-os/MANAGER-METRICS.md`.",
];

test("control: the instruction patterns match every sentence that sent a row to the old tables", () => {
  for (const old of WORDING_BEFORE_THE_SPLIT) assert.ok(OLD_INSTRUCTIONS.some((re) => re.test(old)), `no pattern matches: ${old}`);
});

test("the skill, the core docs and the heartbeat send a ledger row to docs/agent-os/ledger/<job-id>.md and none says to append to the old tables", () => {
  const read = (p) => readFileSync(join(REPO, p), "utf8");
  const skill = read(".claude/skills/monorepo-manager/SKILL.md");
  assert.match(skill, /ledger-render\.mjs --open --tail 5/, "step 1 reads the ledger through the renderer");
  assert.match(skill, /docs\/agent-os\/ledger\/<job-id>\.md/, "step 15 adds the per-job file");
  assert.match(read(".claude/skills/monorepo-manager/references/ledger-and-metrics.md"), /ledger-migrate\.mjs/, "the reference says how a branch that appended to the old table moves its row");
  for (const p of [
    ".claude/skills/monorepo-manager/SKILL.md",
    ".claude/skills/monorepo-manager/references/ledger-and-metrics.md",
    ".claude/skills/session-observer/SKILL.md",
    ".agents/core/PLAYBOOKS.md",
    ".agents/core/LOOPS.md",
    ".agents/core/HEARTBEAT.md",
    ".agents/core/CORE.md",
    ".agents/core/templates/subagent-brief.md",
    ".claude/agents/lane-platform.md",
    "docs/agent-os/NOUR-COMMAND-MODES.md",
  ]) {
    const text = read(p);
    for (const re of OLD_INSTRUCTIONS) assert.doesNotMatch(text, re, `${p} still sends a row to the old tables`);
  }
});

// --- the real tree ---

test("the real tree: stubs hold no table, every job file is clean, the check passes, and views regenerate the files byte for byte", (t) => {
  const dir = join(REPO, "docs", "agent-os", "ledger");
  const names = readdirSync(dir);
  const r = L.ledgerRootProblems(REPO);
  t.diagnostic(`checked ${r.rows} job files, ${r.warnings.length} warning(s)`);
  assert.deepEqual(r.errors, [], `\n${r.errors.join("\n")}`);
  assert.equal(r.rows, names.length, "every file in docs/agent-os/ledger is a job row");
  assert.ok(r.rows >= 48, `only ${r.rows} job files: the migration lost rows`);
  const files = L.migrateTables(L.renderLedger(REPO), L.renderMetrics(REPO));
  assert.deepEqual([...files.keys()], names.map((f) => f.replace(/\.md$/, "")).sort(), "the rendered views name exactly the files on disk");
  for (const [id, text] of files) assert.equal(text, readFileSync(join(dir, `${id}.md`), "utf8"), `${id}.md is not what its own rendered rows regenerate`);
});
