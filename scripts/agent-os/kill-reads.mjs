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
 *   node scripts/agent-os/kill-reads.mjs --due    line 1: `N due, T today` (date <= today / date == today, America/New_York), or
 *                                                 `UNKNOWN (>= N due, T today; <source> failed)` when any source could not be read;
 *                                                 then one `<source>: UNKNOWN (reason)` line per source that could not be read
 *   node scripts/agent-os/kill-reads.mjs --json   {today, due, dueToday, complete, prs, ledger, ship, reads} for a caller
 *   --root <dir>  another repo root   --today YYYY-MM-DD  pin the date   --prs-fixture <file.json>  [{number, body, mergedAt}] instead of gh
 *
 * A source that cannot be read says `<source>: UNKNOWN (reason)` and the others still list: a failed gh is never "no PRs",
 * a bad ledger file is never a silent skip, and a count made from part of the sources is never printed as a bare number.
 * Exit 0 always for a read; 64 for a bad flag.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { arg, flag, isMainModule } from "./cli-common.mjs";
import { loadJobs } from "./ledger-check.mjs";
import { BAR_SECTIONS, ISO_DATE, bodySections } from "./merge-gate.mjs";

// The first day a merged PR body can carry the kill section: 36 PRs merged 2026-10-29..10-31 already do (the manager's body bar, 2026-10-30), ahead of the gate's own #3494.
const SINCE = "2026-10-29";
const LIMIT = 500; // gh's --limit per search; a window that returns this many may be cut short
const KILL_HEADING = BAR_SECTIONS.find((s) => s.dated).re; // merge-gate's own heading regex, never a second one
// merge-gate's date, minus the dates inside a job id such as 2026-10-12-parked-reel-lane (a read is a date, not a name).
const ALL_DATES = new RegExp(`(?<![\\w-])${ISO_DATE.source}(?!-[a-z0-9])`, "g");
// shortcut: a ledger cell is prose, so a date counts as a future read only when one of these words leads it in its clause (`by` only when the date follows it directly); revisit if cells get a dated field.
const CUE = /\b(?:owed|due|until|before|earliest|re-?read|check|kill|review|next)\b/i;
const BY_DATE = /\bby\s+$/i;
// shortcut: a date is a recorded result or a past reference, not a read, when a clock time follows it, merge/merged/deploy follows it, or deploy(s/ed)/merged/merges/landed/posted/since/the leads it; wording-only, revisit if cells get a dated field.
const NOT_READ_AFTER = /^(?:[T\s]\d{1,2}:\d{2}|\s+(?:merge|merged|deploy)\b)/i;
const NOT_READ_LEAD = /\b(?:deploys?|deployed|merged|merges|landed|posted|since|the)\s+$/i;
const isRead = (text, m) => (BY_DATE.test(text.slice(0, m.index)) || !NOT_READ_AFTER.test(text.slice(m.index + m[0].length))) && !NOT_READ_LEAD.test(text.slice(0, m.index)); // "by <date> <time>" is a deadline, kept
const DONE = new Set(["LIVE-VERIFIED", "CANCELLED"]);
const SHIP_LABEL = /kill[- ]criteri(?:on|a)|live[- ]checks?/i;
const ITEM = /^(?:[-*+]|\d+[.)])\s+/;
const LABEL_BREAK = /^(?:\*\*.*\*\*:?|#{1,6}\s.*)$/; // a bold-only line or a heading ends a label's list

const datesIn = (s) => [...new Set([...s.matchAll(ALL_DATES)].filter((m) => isRead(s, m)).map((m) => m[0]))];
const tidy = (s) => s.replace(/^\s*(?:[-*>]\s+)+/, "").replace(/\*\*|__/g, "").trim();
const clip = (s) => (s.length > 110 ? `${s.slice(0, 107)}...` : s);
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.source < b.source ? -1 : a.source > b.source ? 1 : 0);
const read = (date, source, text) => ({ date, source, text: clip(tidy(text)) });
const more = (list) => `${list[0]}${list.length > 1 ? ` (+${list.length - 1} more)` : ""}`;

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

/**
 * Reads from ledger "Next action or blocker" cells of jobs not closed out: a date led by a cue word in its own clause.
 * Anything the ledger tooling cannot parse is pushed onto `problems` (named) and its file skipped, never skipped silently.
 */
export function ledgerReads(root, problems = []) {
  const out = [];
  const { jobs, errors } = loadJobs(root);
  problems.push(...errors);
  for (const job of jobs) {
    if (job.errors.length) {
      problems.push(...job.errors);
      continue;
    }
    if (!job.ledger) {
      problems.push(`${job.id}: no ledger row`);
      continue;
    }
    const cells = job.ledger.slice(1, job.ledger.lastIndexOf("|")).split("|").map((c) => c.trim());
    if (cells.length !== 8) {
      problems.push(`${job.id}: ${cells.length} cells, expected 8`);
      continue;
    }
    if (DONE.has(cells[4])) continue;
    for (const clause of cells[6].split(/(?<=[.;])\s+/)) {
      for (const m of clause.matchAll(ALL_DATES)) {
        const lead = clause.slice(0, m.index).slice(-40);
        if ((CUE.test(lead) || BY_DATE.test(lead)) && isRead(clause, m)) out.push(read(m[0], `ledger ${job.id}`, clause));
      }
    }
  }
  return out.sort(byDate);
}

/** The reads of one ship record's text: a line naming a kill criterion or live check, plus the list items under such a label line until a blank line or the next label. */
function shipFileReads(text, name) {
  const out = [];
  let open = false;
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.replace(/^[\s>]+/, "").trim();
    if (!t) {
      open = false;
      continue;
    }
    const item = ITEM.test(t);
    const label = SHIP_LABEL.test(t);
    if (label || (item && open)) for (const d of datesIn(t)) out.push(read(d, `ship ${name}`, t));
    if (label && !item) open = true;
    else if (!item && LABEL_BREAK.test(t)) open = false;
  }
  return out;
}

/** Reads from ship records. A file or folder that cannot be read goes onto `problems` by name; the others still list. */
export function shipReads(root, problems = []) {
  const out = [];
  const apps = existsSync(join(root, "apps")) ? readdirSync(join(root, "apps")) : [];
  for (const app of apps) {
    const dir = join(root, "apps", app, "docs", "reconciliation");
    if (!existsSync(dir)) continue;
    let names = [];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith(".md"));
    } catch (e) {
      problems.push(`apps/${app}/docs/reconciliation: ${e.code ?? e.message}`);
    }
    for (const name of names) {
      try {
        out.push(...shipFileReads(readFileSync(join(dir, name), "utf8"), name));
      } catch (e) {
        problems.push(`${name}: ${e.code ?? e.message}`);
      }
    }
  }
  return out.sort(byDate);
}

/** Calendar-month windows from `since` through the month of `today`, each { from, to } as YYYY-MM-DD. */
export function windows(since, today) {
  const out = [];
  let [y, m] = since.slice(0, 7).split("-").map(Number);
  const [ty, tm] = today.slice(0, 7).split("-").map(Number);
  let from = since;
  for (;;) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out.push({ from, to: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}` });
    if (y * 12 + m >= ty * 12 + tm) return out;
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
    from = `${y}-${String(m).padStart(2, "0")}-01`;
  }
}

function ghJson(run, args, cwd) {
  const r = run("gh", args, { encoding: "utf8", timeout: 60_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024, cwd });
  if (r.error || r.status !== 0) return { detail: String(r.error?.code ?? r.error?.message ?? `exit ${r.status}`) };
  try {
    return { json: JSON.parse(String(r.stdout).replace(/^﻿/, "")) };
  } catch {
    return { detail: "its answer was not JSON" };
  }
}

/**
 * Merged PRs whose body mentions "kill", one capped gh search per calendar month from SINCE, joined by number. UNKNOWN (never an
 * empty list) when gh is absent, slow, fails, answers junk, a window hits the cap, or one search/issues count says the list is
 * short or incomplete. The rows that did arrive are still returned in `list`.
 */
export function fetchPrs(run = spawnSync, today = etToday(), cwd = undefined) {
  const bad = [];
  const seen = new Map();
  for (const w of windows(SINCE, today)) {
    const span = `${w.from}..${w.to}`;
    const got = ghJson(run, ["pr", "list", "--state", "merged", "--search", `kill in:body merged:${span}`, "--limit", String(LIMIT), "--json", "number,body,mergedAt"], cwd);
    if (got.detail) bad.push(`${span}: ${got.detail}`);
    else if (!Array.isArray(got.json)) bad.push(`${span}: its answer was not a list`);
    else {
      for (const p of got.json) seen.set(p.number, p);
      if (got.json.length >= LIMIT) bad.push(`${span}: returned ${LIMIT}, its cap: the window may be cut short`);
    }
  }
  if (!bad.length) {
    const c = ghJson(run, ["api", `search/issues?q=repo:{owner}/{repo}+is:pr+is:merged+kill+in:body+merged:%3E%3D${SINCE}&per_page=1`], cwd);
    if (c.detail) bad.push(`count check: ${c.detail}`);
    else if (c.json?.incomplete_results === true) bad.push("count check: the search reported incomplete_results");
    else if (!Number.isInteger(c.json?.total_count)) bad.push("count check: no total_count in its answer");
    else if (c.json.total_count > seen.size) bad.push(`count check: search counts ${c.json.total_count}, list has ${seen.size}`);
  }
  const list = [...seen.values()];
  return bad.length ? { state: "UNKNOWN", detail: `gh failed: ${more(bad)}`, list } : { state: "ok", list };
}

/** How many reads are due: date on or before `today` (YYYY-MM-DD strings compare as dates). */
export const dueCount = (reads, today) => reads.filter((r) => r.date <= today).length;
/** How many reads are dated exactly `today`. */
export const dueToday = (reads, today) => reads.filter((r) => r.date === today).length;

/** One source: its reads, UNKNOWN naming the first problem the reader pushed, or UNKNOWN when the read threw. */
function source(fn) {
  const problems = [];
  try {
    const reads = fn(problems);
    return { state: problems.length ? "UNKNOWN" : "ok", ...(problems.length ? { detail: more(problems) } : {}), reads };
  } catch (e) {
    return { state: "UNKNOWN", detail: `cannot read: ${String(e.message).split("\n")[0]}`, reads: [] };
  }
}

/** Every source, merged, sorted, one read per source and date. `prs` is a fetchPrs() result. */
export function collect({ root, today, prs }) {
  const pr = source(() => prReads(prs.list ?? []));
  if (prs.state !== "ok") Object.assign(pr, { state: "UNKNOWN", detail: prs.detail });
  const ledger = source((p) => ledgerReads(root, p));
  const ship = source((p) => shipReads(root, p));
  const keys = new Set();
  const reads = [...pr.reads, ...ledger.reads, ...ship.reads].sort(byDate).filter((r) => {
    const k = `${r.source}|${r.date}`;
    return keys.has(k) ? false : (keys.add(k), true);
  });
  const meta = ({ state, detail }) => ({ state, ...(detail ? { detail } : {}) });
  const out = { today, due: dueCount(reads, today), dueToday: dueToday(reads, today), prs: meta(pr), ledger: meta(ledger), ship: meta(ship) };
  return { ...out, complete: [out.prs, out.ledger, out.ship].every((s) => s.state === "ok"), reads };
}

if (isMainModule(import.meta.url)) {
  const root = resolve(arg("root", resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")));
  const today = arg("today") ?? etToday();
  if (!/^\d{4}-\d\d-\d\d$/.test(today)) {
    console.error(`kill-reads: --today wants YYYY-MM-DD, got "${today}"`);
    process.exit(64);
  }
  const fixture = arg("prs-fixture");
  const prs = fixture ? { state: "ok", list: JSON.parse(readFileSync(fixture, "utf8").replace(/^﻿/, "")) } : fetchPrs(spawnSync, today, root);
  const out = collect({ root, today, prs });
  const failed = ["prs", "ledger", "ship"].filter((k) => out[k].state !== "ok");
  const unknown = failed.map((k) => `${k}: UNKNOWN (${out[k].detail})`);
  const counts = `${out.due} due, ${out.dueToday} today`;
  if (flag("json")) console.log(JSON.stringify(out, null, 2));
  else if (flag("due")) console.log([failed.length ? `UNKNOWN (>= ${counts}; ${failed.join(", ")} failed)` : counts, ...unknown].join("\n"));
  else {
    const lines = out.reads.map((r) => `${r.date}  ${r.source}  ${r.text}${r.date <= today ? " [due]" : ""}`);
    console.log([...unknown, ...lines, `${counts} as of ${today} (America/New_York), ${out.reads.length} dated reads${failed.length ? `; INCOMPLETE: ${failed.join(", ")} failed` : ""}`].join("\n"));
  }
}
