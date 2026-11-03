/**
 * Canary for scripts/agent-os/kill-reads.mjs (job 2026-11-02-nour-os-interconnect, slice R2c, 2026-11-03).
 *
 * Kill criteria and live checks are written in three places (merged PR bodies, ledger "Next action" cells, ship records)
 * and nothing read them: ledger-render --open hides MERGED rows and HEARTBEAT checks 1-10 skip them. This reader lists
 * every dated read and counts the ones due; HEARTBEAT check 11 prints that count.
 *
 * Shape (positive-control-first): a planted dated read is listed, the same text without the date is not; --due counts
 * yesterday + today and not tomorrow; a gh that fails is UNKNOWN (never "no PRs") while the local sources still list;
 * the HEARTBEAT row's own command is run verbatim (assert-the-consumer).
 *
 * Run: node --test scripts/agent-os/killReads.test.mjs   (pnpm agent:verify discovers it)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LEDGER_HEAD } from "./ledger-check.mjs";
// Namespace import: a missing export reads as undefined in its own tests instead of failing the whole file at link time.
import * as gate from "./merge-gate.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(REPO, "scripts", "agent-os", "kill-reads.mjs");
const lib = () => import("./kill-reads.mjs");
const TODAY = "2026-11-03";

// Bodies shaped like merged PR 3532 and 3529 (read 2026-11-03): the heading, then lines that carry the date.
const BAR = (kill) => `## Self-review\n\nRe-read the diff.\n\n## Kill criterion + live check\n\n${kill}\n\n## 10x\n\nNone.\n\n## Second reader\n\nThe manager.\n`;
const prs = (...list) => list.map(([number, body]) => ({ number, body, mergedAt: "2026-11-03T15:53:58Z" }));

const ledgerRow = (id, status, next) => `${LEDGER_HEAD.join("\n")}\n| ${id} | 2026-11-01 | a job | platform | ${status} | #3500 | ${next} | none |\n`;

/** A repo root with docs/agent-os/ledger/<id>.md files and apps/<app>/docs/reconciliation/<name>.md ship records. */
function fixtureRoot({ ledger = [], ship = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "kill-reads-"));
  mkdirSync(join(root, "docs", "agent-os", "ledger"), { recursive: true });
  mkdirSync(join(root, "apps", "statenour", "docs", "reconciliation"), { recursive: true });
  for (const [id, status, next] of ledger) writeFileSync(join(root, "docs", "agent-os", "ledger", `${id}.md`), ledgerRow(id, status, next));
  for (const [name, text] of ship) writeFileSync(join(root, "apps", "statenour", "docs", "reconciliation", name), text);
  return root;
}

/** A child environment with no gh on PATH and no inherited GIT_* (guard-red-team rule 6). */
function envWithoutGh() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(?:path|git_.*)$/i.test(k)));
  return { ...env, PATH: tmpdir() };
}
const run = (args, env = envWithoutGh()) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env, cwd: REPO, timeout: 60_000 });
const fixtureFile = (list) => {
  const f = join(mkdtempSync(join(tmpdir(), "kill-reads-prs-")), "prs.json");
  writeFileSync(f, JSON.stringify(list));
  return f;
};

test("merge-gate exports its heading parser, and it reads the kill section the way the gate does", () => {
  assert.equal(typeof gate.bodySections, "function", "merge-gate.mjs must export bodySections (the one heading parser)");
  const kill = gate.BAR_SECTIONS.find((s) => s.dated);
  const found = gate.bodySections(BAR("Live check 2026-11-10: read it."), kill.re);
  assert.equal(found.length, 1);
  assert.match(found[0].content, /2026-11-10/);
  assert.equal(gate.bodySections("**Kill criterion 2026-11-10**\n\n```\n## Kill criterion\n2026-11-11\n```\n", kill.re).length, 0, "bold text and a fenced heading are not sections");
});

test("a merged PR whose kill section carries a dated line is listed with its date and source", async () => {
  const { prReads } = await lib();
  const reads = prReads(prs([101, BAR("Kill criterion: revert on a red.\n\nLive check 2026-11-04: read origin/main and run ledger-check.")]));
  assert.deepEqual(reads.map((r) => [r.date, r.source]), [["2026-11-04", "pr #101"]]);
  assert.match(reads[0].text, /^Live check 2026-11-04: read origin\/main/);
});

test("the same body with the date removed lists nothing, and a dated line outside the kill section is not a read", async () => {
  const { prReads } = await lib();
  assert.deepEqual(prReads(prs([102, BAR("Live check: read origin/main and run ledger-check.")])), []);
  const outside = `## Self-review\n\nChecked 2026-11-04.\n\n## Kill criterion + live check\n\nKill criterion: revert on a red.\n\n## 10x\n\nBy 2026-12-01 maybe.\n`;
  assert.deepEqual(prReads(prs([103, outside])), []);
});

test("a date in the heading text, a bullet list and two dates on one line each count, and bold or fenced text does not", async () => {
  const { prReads } = await lib();
  const body = "## Kill criterion by 2026-11-17\n\nOpen the page.\n\n- Live check **2026-11-05**: open Home.\n- Kill if gray on 2026-11-23, recheck 2026-11-30.\n\n```\nLive check 2026-12-31\n```\n";
  assert.deepEqual(prReads(prs([104, body])).map((r) => r.date), ["2026-11-05", "2026-11-17", "2026-11-23", "2026-11-30"]);
});

test("a job id such as 2026-10-12-parked-reel-lane is not a date, and a date beside it still is", async () => {
  const { prReads, ledgerReads } = await lib();
  assert.deepEqual(prReads(prs([107, BAR("`2026-10-12-parked-reel-lane` is set to MERGED as requested.")])), []);
  assert.deepEqual(prReads(prs([108, BAR("Live check 2026-11-04 for `2026-10-12-parked-reel-lane`: read the log.")])).map((r) => r.date), ["2026-11-04"]);
  const root = fixtureRoot({ ledger: [["2026-11-01-chained", "MERGED", "superseded by 2026-10-16-reel-autonomy (#3069)"]] });
  assert.deepEqual(ledgerReads(root), []);
});

test("a ledger Next cell with a read cue and a date is listed; a finished row and a past-event date are not", async () => {
  const { ledgerReads } = await lib();
  const root = fixtureRoot({
    ledger: [
      ["2026-11-01-owed-read", "MERGED", "live check owed on 2026-11-09: count the rows"],
      ["2026-11-01-done-job", "LIVE-VERIFIED", "live check owed on 2026-11-09: already proven"],
      ["2026-11-01-history", "MERGED", "applied 2026-11-02; nothing owed"],
    ],
  });
  const reads = ledgerReads(root);
  assert.deepEqual(reads.map((r) => [r.date, r.source]), [["2026-11-09", "ledger 2026-11-01-owed-read"]]);
});

test("a ship record line naming a kill criterion or live check with an ISO date is listed; other dated lines are not", async () => {
  const { shipReads } = await lib();
  const root = fixtureRoot({ ship: [["2026-11-02-x.md", "# Ship\n\nShipped 2026-11-02.\n\n> - 2026-11-23 (kill criterion L2): every goal still gray.\nLive check 2026-11-09: read the log.\nLive check without a date.\n"]] });
  assert.deepEqual(shipReads(root).map((r) => [r.date, r.source]), [["2026-11-09", "ship 2026-11-02-x.md"], ["2026-11-23", "ship 2026-11-02-x.md"]]);
});

test("--due counts a read dated yesterday or today and not tomorrow", async () => {
  const { dueCount } = await lib();
  const reads = [{ date: "2026-11-02" }, { date: "2026-11-03" }, { date: "2026-11-04" }];
  assert.equal(dueCount(reads, TODAY), 2);
});

test("today is the America/New_York date, not the UTC one", async () => {
  const { etToday } = await lib();
  assert.equal(etToday(new Date("2026-11-04T03:30:00Z")), "2026-11-03", "03:30Z is 22:30 on the 3rd in New York");
  assert.equal(etToday(new Date("2026-11-04T12:00:00Z")), "2026-11-04");
});

test("a gh call that fails is UNKNOWN, never an empty list; a real empty list is ok", async () => {
  const { fetchPrs } = await lib();
  const fake = (r) => () => r;
  assert.equal(fetchPrs(fake({ status: 1, stdout: "", stderr: "boom" })).state, "UNKNOWN");
  assert.equal(fetchPrs(fake({ status: null, error: Object.assign(new Error("spawnSync gh ETIMEDOUT"), { code: "ETIMEDOUT" }) })).state, "UNKNOWN");
  assert.equal(fetchPrs(fake({ status: 0, stdout: "not json" })).state, "UNKNOWN");
  assert.equal(fetchPrs(fake({ status: 0, stdout: JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ number: i, body: "", mergedAt: "" }))) })).state, "UNKNOWN", "a list at the --limit cap may be truncated");
  const empty = fetchPrs(fake({ status: 0, stdout: "[]" }));
  assert.deepEqual([empty.state, empty.list], ["ok", []]);
});

test("the CLI lists the planted PR read from a fixture, sorted by date, one line each", () => {
  const root = fixtureRoot({ ledger: [["2026-11-01-owed-read", "MERGED", "live check owed on 2026-11-09: count the rows"]] });
  const file = fixtureFile(prs([105, BAR("Live check 2026-11-12: later.")], [106, BAR("Live check 2026-11-04: sooner.")]));
  const r = run(["--root", root, "--today", TODAY, "--prs-fixture", file]);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split("\n").filter((l) => /^\d{4}-\d\d-\d\d /.test(l));
  assert.deepEqual(lines.map((l) => l.split(/\s{2,}/).slice(0, 2)), [["2026-11-04", "pr #106"], ["2026-11-09", "ledger 2026-11-01-owed-read"], ["2026-11-12", "pr #105"]]);
});

test("with gh missing the CLI prints prs: UNKNOWN and still lists the local sources, exit 0", () => {
  const root = fixtureRoot({ ledger: [["2026-11-01-owed-read", "MERGED", "live check owed on 2026-11-09: count the rows"]] });
  const r = run(["--root", root, "--today", TODAY]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^prs: UNKNOWN \(gh failed/m);
  assert.match(r.stdout, /^2026-11-09\s+ledger 2026-11-01-owed-read/m);
});

test("--due prints the count first (past or today only) and flags an UNKNOWN prs source on the next line; --json carries the same count", () => {
  const root = fixtureRoot({
    ledger: [
      ["2026-11-01-a", "MERGED", "live check owed on 2026-11-02: a"],
      ["2026-11-01-b", "MERGED", "live check owed on 2026-11-03: b"],
      ["2026-11-01-c", "MERGED", "live check owed on 2026-11-04: c"],
    ],
  });
  const due = run(["--root", root, "--today", TODAY, "--due"]);
  assert.equal(due.status, 0, due.stderr);
  const out = due.stdout.trim().split("\n");
  assert.equal(out[0], "2");
  assert.match(out[1] ?? "", /^prs: UNKNOWN/);
  const json = JSON.parse(run(["--root", root, "--today", TODAY, "--json"]).stdout);
  assert.deepEqual([json.today, json.due, json.prs.state, json.reads.length], [TODAY, 2, "UNKNOWN", 3]);
});

test("HEARTBEAT.md check 11 names the script, and its own command runs verbatim and prints a count (assert-the-consumer)", () => {
  const text = readFileSync(join(REPO, ".agents", "core", "HEARTBEAT.md"), "utf8");
  const row = text.split("\n").find((l) => /^\|\s*11\s*\|/.test(l));
  assert.ok(row, "HEARTBEAT.md has no check 11 row");
  assert.match(row, /kill reads due/i);
  assert.match(row, /\|\s*no\s*\|\s*$/, "check 11 is optional: Required = no");
  const cmd = /`(node scripts\/agent-os\/kill-reads\.mjs --due)`/.exec(row)?.[1];
  assert.ok(cmd, "the row's How cell must carry the backticked command");
  const r = spawnSync(process.execPath, cmd.split(" ").slice(1), { encoding: "utf8", env: envWithoutGh(), cwd: REPO, timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout.split("\n")[0], /^\d+$/, "the first line is the bare count");
});

test("the agent-os README carries a registry row for kill-reads.mjs", () => {
  assert.match(readFileSync(join(REPO, "docs", "agent-os", "README.md"), "utf8"), /kill-reads\.mjs/);
});
