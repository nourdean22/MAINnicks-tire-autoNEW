#!/usr/bin/env node
/**
 * Kill reads: every dated kill criterion or live check the repo already writes, listed with its date (2026-11-03,
 * job 2026-11-02-nour-os-interconnect, slice R2c).
 *
 * The dates sit in three places and nothing read them (ledger-render --open hides MERGED rows, HEARTBEAT checks 1-10 skip
 * them): merged PR bodies (merge-gate.mjs has required the "Kill criterion + live check" heading since #3494), ledger
 * "Next action or blocker" cells, and ship records (apps/<app>/docs/reconciliation/*.md).
 *
 *   node scripts/agent-os/kill-reads.mjs          one line per dated read, sorted by date: date, source, text; "[due]" = on or before today
 *   node scripts/agent-os/kill-reads.mjs --due    the count of reads due (date <= today, America/New_York) on line 1, then one line per source that could not be read
 *   node scripts/agent-os/kill-reads.mjs --json   {today, due, prs, ledger, ship, reads} for a caller
 *   --root <dir>  another repo root   --today YYYY-MM-DD  pin the date   --prs-fixture <file.json>  [{number, body, mergedAt}] instead of gh
 *
 * A source that cannot be read says `<source>: UNKNOWN (reason)` and the others still list: a failed gh is never "no PRs".
 * Exit 0 always for a read; 64 for a bad flag.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { arg, flag, isMainModule } from "./cli-common.mjs";
import { loadJobs } from "./ledger-check.mjs";
import { BAR_SECTIONS, ISO_DATE, bodySections } from "./merge-gate.mjs";

const SINCE = "2026-11-01"; // the first day the PR body bar was in force (#3494): older merged bodies have no required heading
const LIMIT = 500;
const KILL_HEADING = BAR_SECTIONS.find((s) => s.dated).re; // merge-gate's own heading regex, never a second one
// merge-gate's date, minus the dates inside a job id such as 2026-10-12-parked-reel-lane (a read is a date, not a name).
const ALL_DATES = new RegExp(`(?<![\\w-])${ISO_DATE.source}(?!-[a-z0-9])`, "g");
// shortcut: a ledger cell is prose, so a date counts as a future read only when one of these words leads it in its clause; revisit if cells get a dated field.
const CUE = /\b(?:owed|due|by|until|before|earliest|re-?read|check|kill|review|next)\b/i;
const DONE = new Set(["LIVE-VERIFIED", "CANCELLED"]);

const datesIn = (s) => [...new Set(s.match(ALL_DATES) ?? [])];
const tidy = (s) => s.replace(/^\s*(?:[-*>]\s+)+/, "").replace(/\*\*|__/g, "").trim();
const clip = (s) => (s.length > 110 ? `${s.slice(0, 107)}...` : s);
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.source < b.source ? -1 : a.source > b.source ? 1 : 0);
const read = (date, source, text) => ({ date, source, text: clip(tidy(text)) });

/** The America/New_York calendar date of `now` as YYYY-MM-DD (en-CA prints that order). */
export function etToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

/** Reads from merged PR bodies: each dated line (or heading) inside a "Kill criterion" section, one read per distinct date on it. */
export function prReads(prs) {
  const out = [];
  for (const pr of prs) {
    if (typeof pr.body !== "string") continue;
    for (const s of bodySections(pr.body, KILL_HEADING)) {
      for (const line of [s.text, ...s.content.split(/\r?\n/)]) for (const d of datesIn(line)) out.push(read(d, `pr #${pr.number}`, line));
    }
  }
  return out.sort(byDate);
}

/** Reads from ledger "Next action or blocker" cells of jobs not closed out: a date led by a cue word in its own clause. */
export function ledgerReads(root) {
  const out = [];
  for (const job of loadJobs(root).jobs) {
    if (!job.ledger) continue;
    const cells = job.ledger.slice(1, job.ledger.lastIndexOf("|")).split("|").map((c) => c.trim());
    if (DONE.has(cells[4])) continue;
    for (const clause of (cells[6] ?? "").split(/(?<=[.;])\s+/)) {
      for (const m of clause.matchAll(ALL_DATES)) if (CUE.test(clause.slice(0, m.index).slice(-40))) out.push(read(m[0], `ledger ${job.id}`, clause));
    }
  }
  return out.sort(byDate);
}

/** Reads from ship records: a line naming a kill criterion or a live check, one read per ISO date on it. */
export function shipReads(root) {
  const out = [];
  const apps = existsSync(join(root, "apps")) ? readdirSync(join(root, "apps")) : [];
  for (const app of apps) {
    const dir = join(root, "apps", app, "docs", "reconciliation");
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
      for (const line of readFileSync(join(dir, name), "utf8").split(/\r?\n/)) {
        if (/kill criterion|live check/i.test(line)) for (const d of datesIn(line)) out.push(read(d, `ship ${name}`, line));
      }
    }
  }
  return out.sort(byDate);
}

/** Merged PRs since SINCE through gh. UNKNOWN (never an empty list) when gh is absent, slow, fails, answers junk, or hits the cap. */
export function fetchPrs(run = spawnSync) {
  const args = ["pr", "list", "--state", "merged", "--search", `merged:>=${SINCE}`, "--limit", String(LIMIT), "--json", "number,body,mergedAt"];
  const r = run("gh", args, { encoding: "utf8", timeout: 60_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) return { state: "UNKNOWN", detail: `gh failed: ${r.error?.code ?? r.error?.message ?? `exit ${r.status}`}` };
  let list;
  try {
    list = JSON.parse(String(r.stdout).replace(/^﻿/, ""));
  } catch {
    return { state: "UNKNOWN", detail: "gh failed: its answer was not JSON" };
  }
  if (!Array.isArray(list)) return { state: "UNKNOWN", detail: "gh failed: its answer was not a list" };
  if (list.length >= LIMIT) return { state: "UNKNOWN", detail: `gh returned ${LIMIT}, its cap: the list may be cut short` };
  return { state: "ok", list };
}

/** How many reads are due: date on or before `today` (YYYY-MM-DD strings compare as dates). */
export const dueCount = (reads, today) => reads.filter((r) => r.date <= today).length;

/** One source: its reads, or UNKNOWN with the reason when the read threw. */
function source(fn) {
  try {
    return { state: "ok", reads: fn() };
  } catch (e) {
    return { state: "UNKNOWN", detail: `cannot read: ${String(e.message).split("\n")[0]}`, reads: [] };
  }
}

/** Every source, merged and sorted. `prs` is a fetchPrs() result. */
export function collect({ root, today, prs }) {
  const pr = prs.state === "ok" ? source(() => prReads(prs.list)) : { state: "UNKNOWN", detail: prs.detail, reads: [] };
  const ledger = source(() => ledgerReads(root));
  const ship = source(() => shipReads(root));
  const reads = [...pr.reads, ...ledger.reads, ...ship.reads].sort(byDate);
  const meta = ({ state, detail }) => ({ state, ...(detail ? { detail } : {}) });
  return { today, due: dueCount(reads, today), prs: meta(pr), ledger: meta(ledger), ship: meta(ship), reads };
}

if (isMainModule(import.meta.url)) {
  const root = resolve(arg("root", resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")));
  const today = arg("today") ?? etToday();
  if (!/^\d{4}-\d\d-\d\d$/.test(today)) {
    console.error(`kill-reads: --today wants YYYY-MM-DD, got "${today}"`);
    process.exit(64);
  }
  const fixture = arg("prs-fixture");
  const prs = fixture ? { state: "ok", list: JSON.parse(readFileSync(fixture, "utf8").replace(/^﻿/, "")) } : fetchPrs();
  const out = collect({ root, today, prs });
  const unknown = ["prs", "ledger", "ship"].filter((k) => out[k].state !== "ok").map((k) => `${k}: UNKNOWN (${out[k].detail})`);
  if (flag("json")) console.log(JSON.stringify(out, null, 2));
  else if (flag("due")) console.log([String(out.due), ...unknown].join("\n"));
  else {
    const lines = out.reads.map((r) => `${r.date}  ${r.source}  ${r.text}${r.date <= today ? " [due]" : ""}`);
    console.log([...unknown, ...lines, `${out.due} due as of ${today} (America/New_York), ${out.reads.length} dated reads`].join("\n"));
  }
}
