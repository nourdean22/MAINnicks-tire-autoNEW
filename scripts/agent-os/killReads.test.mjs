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

test("a ship record's list items under a Live checks label each count, until the blank line or the next label", async () => {
  const { shipReads } = await lib();
  // The shape of apps/statenour/docs/reconciliation/2026-11-02-goal-card-health.md:22-24 (read 2026-11-03).
  const text = "> **Live checks owed**\n> - 2026-11-09: one check-in saved from the card.\n> - 2026-11-23 (kill criterion L2): every goal still gray.\n>\n> **Flagged · NOT fixed**\n> - 2026-12-25 something else.\n\nKill criteria\n1. 2026-11-30 revert if red.\n\nProse 2026-12-31.\n";
  const root = fixtureRoot({ ship: [["2026-11-02-goal-card-health.md", text]] });
  assert.deepEqual(shipReads(root).map((r) => r.date), ["2026-11-09", "2026-11-23", "2026-11-30"]);
});

test("one unreadable ship file makes the ship source UNKNOWN by name and the other files still list; no apps folder is no reads, not a throw", async () => {
  const { collect, shipReads } = await lib();
  const root = fixtureRoot({ ship: [["2026-11-02-good.md", "Live check 2026-11-09: read the log.\n"]] });
  mkdirSync(join(root, "apps", "statenour", "docs", "reconciliation", "x.md")); // readFileSync on it throws EISDIR
  const out = collect({ root, today: TODAY, prs: { state: "ok", list: [] } });
  assert.equal(out.ship.state, "UNKNOWN");
  assert.match(out.ship.detail, /x\.md.*EISDIR/);
  assert.deepEqual(out.reads.map((r) => r.source), ["ship 2026-11-02-good.md"]);
  const bare = mkdtempSync(join(tmpdir(), "kill-reads-bare-"));
  assert.deepEqual(shipReads(bare), []);
});

test("a ledger file with a conflict marker or a bad header is UNKNOWN by name, and the good files still list", async () => {
  const { collect } = await lib();
  const root = fixtureRoot({ ledger: [["2026-11-01-good", "MERGED", "live check owed on 2026-11-09: count the rows"]] });
  const dir = join(root, "docs", "agent-os", "ledger");
  writeFileSync(join(dir, "2026-11-01-conflict.md"), `${ledgerRow("2026-11-01-conflict", "MERGED", "live check owed on 2026-11-10: x")}<<<<<<< ours\n`);
  writeFileSync(join(dir, "2026-11-01-badhead.md"), "| Job id | Date |\n|---|---|\n| 2026-11-01-badhead | 2026-11-01 |\n");
  writeFileSync(join(dir, "2026-11-01-sevencells.md"), `${LEDGER_HEAD.join("\n")}\n| 2026-11-01-sevencells | 2026-11-01 | job | platform | MERGED | #1 | live check owed on 2026-11-11: x |\n`);
  const out = collect({ root, today: TODAY, prs: { state: "ok", list: [] } });
  assert.equal(out.ledger.state, "UNKNOWN");
  assert.match(out.ledger.detail, /2026-11-01-(conflict|badhead|sevencells)/);
  assert.deepEqual(out.reads.map((r) => r.source), ["ledger 2026-11-01-good"]);
  assert.equal(out.complete, false);
});

test("the cue by counts only with the date right after it, and one source on one date is one read", async () => {
  const { ledgerReads, collect } = await lib();
  const root = fixtureRoot({
    ledger: [
      ["2026-11-01-by-date", "MERGED", "owner manager, by 2026-11-09: run it"],
      ["2026-11-01-by-nour", "MERGED", "applied by Nour on 2026-11-02; nothing else"],
      ["2026-11-01-twice", "MERGED", "live check owed 2026-11-09: a; kill read owed 2026-11-09: b"],
    ],
  });
  assert.deepEqual(ledgerReads(root).map((r) => r.source).sort(), ["ledger 2026-11-01-by-date", "ledger 2026-11-01-twice", "ledger 2026-11-01-twice"]);
  assert.deepEqual(collect({ root, today: TODAY, prs: { state: "ok", list: [] } }).reads.map((r) => r.source), ["ledger 2026-11-01-by-date", "ledger 2026-11-01-twice"]);
});

// Not-a-read shapes (2026-11-07 sweep: 11 of 21 old "due" items were these). Each shape carries a real read beside it so a rule that
// drops the whole line fails (positive-control-first).
const REAL = "Live check 2026-11-14: count the rows";
test("a date followed by a clock time is a recorded result, not a read", async () => {
  const { prReads } = await lib();
  const body = BAR(`${REAL}. Live check 2026-10-15 17:56Z: steps 1-6 PASS.\nLive check 2026-10-16T21:07:52Z passed.`);
  assert.deepEqual(prReads(prs([201, body])).map((r) => r.date), ["2026-11-14"]);
});

test("a date led by deploy, deployed, merged, landed, posted, since or the is a past reference, not a read", async () => {
  const { prReads } = await lib();
  for (const lead of ["if it deploys", "once deployed", "after it merged", "which landed", "it posted", "unchanged since", "same rule as the"]) {
    assert.deepEqual(prReads(prs([202, BAR(`${REAL}, ${lead} 2026-10-31.`)])).map((r) => r.date), ["2026-11-14"], lead);
  }
});

test("a date followed by merge, merged or deploy is a past reference, not a read", async () => {
  const { prReads } = await lib();
  for (const tail of ["merge", "merged", "deploy"]) {
    assert.deepEqual(prReads(prs([203, BAR(`${REAL}; 2026-09-16 ${tail} date.`)])).map((r) => r.date), ["2026-11-14"], tail);
  }
});

test("positive control: 'read on 2026-11-14 if it deploys 2026-10-31' still yields 2026-11-14, and a ledger cell follows the same rule", async () => {
  const { prReads, ledgerReads } = await lib();
  assert.deepEqual(prReads(prs([204, BAR("Live check: read on 2026-11-14 if it deploys 2026-10-31.")])).map((r) => r.date), ["2026-11-14"]);
  const root = fixtureRoot({
    ledger: [
      ["2026-11-01-clock", "MERGED", "Live check 2026-10-15 17:56Z: step 7 FAIL"],
      ["2026-11-01-lead", "MERGED", "kill read owed 2026-11-09 if it deploys 2026-10-31"],
    ],
  });
  assert.deepEqual(ledgerReads(root).map((r) => [r.date, r.source]), [["2026-11-09", "ledger 2026-11-01-lead"]]);
});

test("a deadline 'by <date> <time>' is still a read (PRs 3458..3470 wrote 'by 2026-11-01 12:00Z'), a recorded 'read <date> <time>' is not", async () => {
  const { prReads } = await lib();
  const dates = (kill) => prReads(prs([205, BAR(kill)])).map((r) => r.date);
  assert.deepEqual(dates("Kill: if no PR by 2026-11-01 12:00Z, escalate."), ["2026-11-01"]);
  assert.deepEqual(dates("Live check, read 2026-11-07 15:23Z on main."), []);
});

test("--due counts a read dated yesterday or today and not tomorrow, and counts today's apart", async () => {
  const { dueCount, dueToday } = await lib();
  const reads = [{ date: "2026-11-02" }, { date: "2026-11-03" }, { date: "2026-11-04" }];
  assert.equal(dueCount(reads, TODAY), 2);
  assert.equal(dueToday(reads, TODAY), 1);
});

test("today is the America/New_York date, not the UTC one", async () => {
  const { etToday } = await lib();
  assert.equal(etToday(new Date("2026-11-04T03:30:00Z")), "2026-11-03", "03:30Z is 22:30 on the 3rd in New York");
  assert.equal(etToday(new Date("2026-11-04T12:00:00Z")), "2026-11-04");
  assert.equal(etToday(new Date("2026-07-01T04:30:00Z")), "2026-07-01", "summer time: 04:30Z is 00:30 EDT on the 1st, not the 30th");
});

const rows = (n) => Array.from({ length: n }, (_, i) => ({ number: i + 1, body: "", mergedAt: "" }));
/** A fake gh: answers `pr list` with `list` and the `api search/issues` count call with `count`; records every argv. */
function fakeGh({ list = { status: 0, stdout: "[]" }, count = { status: 0, stdout: JSON.stringify({ total_count: 0, incomplete_results: false }) } } = {}) {
  const calls = [];
  const run = (cmd, args) => {
    calls.push(args);
    assert.equal(cmd, "gh");
    return args[0] === "api" ? count : list;
  };
  return { run, calls };
}
const listOf = (n) => ({ status: 0, stdout: JSON.stringify(rows(n)) });
const countOf = (total, incomplete = false) => ({ status: 0, stdout: JSON.stringify({ total_count: total, incomplete_results: incomplete }) });

test("a gh call that fails is UNKNOWN, never an empty list; a real empty list is ok", async () => {
  const { fetchPrs } = await lib();
  const state = (list, count) => fetchPrs(fakeGh({ list, count }).run, TODAY).state;
  assert.equal(state({ status: 1, stdout: "", stderr: "boom" }), "UNKNOWN");
  assert.equal(state({ status: null, error: Object.assign(new Error("spawnSync gh ETIMEDOUT"), { code: "ETIMEDOUT" }) }), "UNKNOWN");
  assert.equal(state({ status: 0, stdout: "not json" }), "UNKNOWN");
  assert.equal(state({ status: 0, stdout: "null" }), "UNKNOWN", "null is not a list");
  assert.equal(state({ status: 0, stdout: "{}" }), "UNKNOWN", "an object is not a list");
  assert.equal(state(listOf(500), countOf(500)), "UNKNOWN", "a window at the --limit cap may be truncated");
  assert.equal(state(listOf(499), countOf(499)), "ok", "one under the cap is a whole list");
  const empty = fetchPrs(fakeGh().run, TODAY);
  assert.deepEqual([empty.state, empty.list], ["ok", []]);
});

test("fetchPrs sends one capped merged search per calendar month from 2026-10-29, with kill in:body, and joins them", async () => {
  const { fetchPrs, windows } = await lib();
  assert.deepEqual(windows("2026-10-29", TODAY), [{ from: "2026-10-29", to: "2026-10-31" }, { from: "2026-11-01", to: "2026-11-30" }]);
  assert.deepEqual(windows("2026-10-29", "2027-01-15").map((w) => w.to), ["2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31"]);
  const gh = fakeGh({ list: listOf(3), count: countOf(3) });
  const out = fetchPrs(gh.run, TODAY);
  const lists = gh.calls.filter((a) => a[0] === "pr");
  assert.equal(lists.length, 2);
  for (const a of lists) assert.deepEqual([a[a.indexOf("--limit") + 1], a[a.indexOf("--state") + 1]], ["500", "merged"]);
  assert.deepEqual(lists.map((a) => a[a.indexOf("--search") + 1]), ["kill in:body merged:2026-10-29..2026-10-31", "kill in:body merged:2026-11-01..2026-11-30"]);
  assert.deepEqual([out.state, out.list.length], ["ok", 3], "the same three PRs from both windows join to three");
  const api = gh.calls.filter((a) => a[0] === "api");
  assert.equal(api.length, 1, "one search/issues count call");
  for (const part of ["search/issues?q=", "is:pr", "is:merged", "kill+in:body", "merged:%3E%3D2026-10-29", "per_page=1"]) assert.ok(api[0][1].includes(part), `the count call carries ${part}: ${api[0][1]}`);
});

test("a window at the cap is UNKNOWN but its rows still list; a search count above the list, an incomplete search or a failed count call is UNKNOWN", async () => {
  const { fetchPrs } = await lib();
  const capped = fetchPrs(fakeGh({ list: listOf(500), count: countOf(500) }).run, TODAY);
  assert.deepEqual([capped.state, capped.list.length], ["UNKNOWN", 500]);
  assert.match(capped.detail, /2026-10-29\.\.2026-10-31.*cap/);
  const more = fetchPrs(fakeGh({ list: listOf(3), count: countOf(4) }).run, TODAY);
  assert.equal(more.state, "UNKNOWN");
  assert.match(more.detail, /search counts 4, list has 3/);
  assert.equal(fetchPrs(fakeGh({ list: listOf(3), count: countOf(3, true) }).run, TODAY).state, "UNKNOWN", "incomplete_results");
  assert.equal(fetchPrs(fakeGh({ list: listOf(3), count: { status: 1, stdout: "" } }).run, TODAY).state, "UNKNOWN", "a count that could not be checked is not a whole list");
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

const threeDays = () =>
  fixtureRoot({
    ledger: [
      ["2026-11-01-a", "MERGED", "live check owed on 2026-11-02: a"],
      ["2026-11-01-b", "MERGED", "live check owed on 2026-11-03: b"],
      ["2026-11-01-c", "MERGED", "live check owed on 2026-11-04: c"],
    ],
  });

test("--due line 1 is never a bare number when a source failed: UNKNOWN (>= N due, T today; source failed), then the reason; --json says complete: false", () => {
  const root = threeDays();
  const due = run(["--root", root, "--today", TODAY, "--due"]);
  assert.equal(due.status, 0, due.stderr);
  const out = due.stdout.trim().split("\n");
  assert.equal(out[0], "UNKNOWN (>= 2 due, 1 today; prs failed)");
  assert.match(out[1] ?? "", /^prs: UNKNOWN/);
  const json = JSON.parse(run(["--root", root, "--today", TODAY, "--json"]).stdout);
  assert.deepEqual([json.today, json.due, json.dueToday, json.complete, json.prs.state, json.reads.length], [TODAY, 2, 1, false, "UNKNOWN", 3]);
});

test("--due line 1 is `N due, T today` when every source read, and --json says complete: true", () => {
  const root = threeDays();
  const file = fixtureFile(prs([109, BAR("Live check 2026-11-03: today's.")]));
  const due = run(["--root", root, "--today", TODAY, "--prs-fixture", file, "--due"]);
  assert.equal(due.status, 0, due.stderr);
  assert.equal(due.stdout.trim(), "3 due, 2 today");
  const json = JSON.parse(run(["--root", root, "--today", TODAY, "--prs-fixture", file, "--json"]).stdout);
  assert.deepEqual([json.due, json.dueToday, json.complete], [3, 2, true]);
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
  assert.match(r.stdout.split("\n")[0], /^(?:\d+ due, \d+ today|UNKNOWN \(>= \d+ due, \d+ today; [a-z, ]+ failed\))$/, "line 1 is the count, or UNKNOWN naming the source");
  assert.doesNotMatch(r.stdout, /^(?:ledger|ship): UNKNOWN/m, "the real ledger and ship records read clean");
  assert.match(row, /UNKNOWN/, "the row tells the heartbeat what an UNKNOWN line 1 means");
});

test("the agent-os README carries a registry row for kill-reads.mjs", () => {
  const readme = readFileSync(join(REPO, "docs", "agent-os", "README.md"), "utf8");
  assert.match(readme, /kill-reads\.mjs/);
  assert.match(readme, /merged PR bodies since 2026-10-29/);
  assert.doesNotMatch(readme, /merged PR bodies since 2026-11-01/);
});

test("a date led by 'the' is a past reference, but 'before/by/until/due the <date>' is still a deadline", async () => {
  const { prReads } = await lib();
  const dates = (kill) => prReads(prs([206, BAR(kill)])).map((r) => r.date);
  assert.deepEqual(dates("Kill: the 2026-09-16 baseline was 19 clicks."), []);
  assert.deepEqual(dates("Kill: revert if no lift before the 2026-11-16 cutover."), ["2026-11-16"]);
  assert.deepEqual(dates("Kill: drop it if unused by the 2026-12-01 review."), ["2026-12-01"]);
});
