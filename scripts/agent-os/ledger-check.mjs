#!/usr/bin/env node
/**
 * Manager ledger hygiene check (2026-10-15).
 *
 * The ledger is read by the next manager at session start. Four rows went stale on 2026-10-15 because the PR / SHA cell
 * held `pending (<branch>)` after the PR merged: nothing re-read the row. A row can only reach main through its own PR's
 * merge, so on main `pending` is always wrong. The fix is to write the row as MERGED with the PR cell `this PR` in the PR
 * that merges it; the number is one git command away:
 *   git log -S"<job id>" --format="%h %s" -- docs/agent-os/ledger/<job id>.md
 *
 * Layout (2026-10-16): one file per job, docs/agent-os/ledger/<job-id>.md, holding that job's one-row ledger table and,
 * if it has one, its one-row metrics table, nothing else. Two PRs that add two files never touch the same line, which the
 * old shared table (every PR appended at its tail) could not promise. MANAGER-LEDGER.md and MANAGER-METRICS.md keep only
 * their prose (the Status vocabulary and the rules); the tables are rendered on demand (ledger-render.mjs), never stored.
 * The checks below run on that rendered text, so every rule that held for the shared table still holds, row by row.
 *
 * The table is found by its `| Job id |` header and ends at the first line that is not a table row; prose above it is
 * ignored. Errors (exit 1): no header or separator, a header with no rows, a job row below the table's end (a blank line or
 * a prefix such as "> " or "- " hides it from the parser), a row without 8 cells, an unknown status, a malformed or
 * duplicate job id, an empty PR / SHA cell, `pending`/`TBD`/`TODO` in it. Warnings (exit 0): an open status (PLANNED,
 * RUNNING, BUILT) with `this PR` (true only after the merge, when the status is already wrong) or with a PR cell that
 * says MERGED. Per-file errors: a git conflict marker, a file name that is not a job id, a row for another job, a header
 * that drifted, a metrics row without 8 cells, any line that is not one of the two tables, a table row left in a stub.
 * Exit 2: a file or the ledger directory cannot be read.
 *
 * Run: node scripts/agent-os/ledger-check.mjs [--root <repo root>]   (default: this repo)
 *      node scripts/agent-os/ledger-check.mjs --file <path>            (one already-rendered table text)
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { arg, isMainModule } from "./cli-common.mjs";

const COLS = 8;
const PR_CELL = 5;
const STATUS_CELL = 4;
const STALE = /\b(pending|tbd|todo)\b/i;
const OPEN = new Set(["PLANNED", "RUNNING", "BUILT"]);

/** Returns { errors, warnings, rows } for the text of a ledger file. */
export function ledgerProblems(text) {
  const errors = [];
  const warnings = [];
  const lines = text.split(/\r?\n/);
  const statusLine = lines.find((l) => /^Status:\s/.test(l));
  const allowed = new Set((statusLine ?? "").replace(/^Status:\s*/, "").split("|").map((s) => s.trim()).filter(Boolean));
  if (!allowed.size) errors.push("no `Status: A | B | ...` line: the allowed statuses cannot be read");

  const isRow = (l) => l.trimStart().startsWith("|");
  const head = lines.findIndex((l) => /^\s*\|\s*Job id\s*\|/i.test(l));
  if (head < 0) {
    errors.push("no `| Job id | ...` header line: the table cannot be found");
    return { errors, warnings, rows: 0 };
  }
  if (!/^\s*\|[\s:|-]+$/.test(lines[head + 1] ?? "")) errors.push("the header is not followed by a |---| separator row, so its first data row would be dropped as the separator");
  let end = head + 2;
  while (end < lines.length && isRow(lines[end])) end++;
  const rows = lines.slice(head + 2, end).map((l) => l.trim()); // tab- or space-indented rows count
  if (!rows.length) errors.push("the table has a header but no rows");
  // A job row after the table's end (a blank line, a "> " or "- " prefix) would be skipped without a word.
  for (const l of lines.slice(end)) if (/\|\s*\d{4}-\d{2}-\d{2}-[a-z0-9-]+\s*\|/.test(l)) errors.push(`${l.trim().slice(0, 50)}: a job row below the table's end, not parsed (a blank line or a prefix ended the table above it)`);
  const seen = new Set();
  for (const line of rows) {
    const cells = line.slice(1, line.lastIndexOf("|")).split("|").map((c) => c.trim());
    const id = cells[0] ?? "";
    if (cells.length !== COLS) {
      errors.push(`${id || line.slice(0, 40)}: ${cells.length} cells, expected ${COLS} (a stray | inside a cell?)`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/.test(id)) errors.push(`${id}: job id must be yyyy-mm-dd-slug`);
    if (seen.has(id)) errors.push(`${id}: duplicate job id`);
    seen.add(id);
    const status = cells[STATUS_CELL];
    if (allowed.size && !allowed.has(status)) errors.push(`${id}: status "${status}" is not one of ${[...allowed].join(" | ")}`);
    const pr = cells[PR_CELL];
    if (!pr) errors.push(`${id}: PR / SHA cell is empty: write "this PR", a number, or "none"`);
    if (STALE.test(pr)) errors.push(`${id}: PR / SHA cell says "${pr.match(STALE)[0]}". A row on main got there by its merge: write "this PR", a number, or "none"`);
    if (OPEN.has(status) && /\bthis PR\b/i.test(pr)) warnings.push(`${id}: ${status} with "this PR" is true only after the merge, when the status is stale: write MERGED`);
    if (OPEN.has(status) && /\bMERGED\b/.test(pr)) warnings.push(`${id}: status is ${status} but the PR / SHA cell says MERGED: update the status`);
  }
  return { errors, warnings, rows: rows.length };
}

// ---- the per-job layout -------------------------------------------------------------------------------------------

export const LEDGER_HEAD = [
  "| Job id | Date | Job | Lanes | Status | PR / SHA | Next action or blocker | Lesson |",
  "|---|---|---|---|---|---|---|---|",
];
export const METRICS_HEAD = [
  "| Job id | After the PR opened (Codex, human) | Manager catches before it opened | Red-first (new tests red on unfixed code / new tests) | Mutation (killed / tried) | Cycle time (first dispatch to merge) | Rework pushes | Source |",
  "|---|---|---|---|---|---|---|---|",
];
export const JOB_ID = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/;
const DIR = "docs/agent-os/ledger";
const STUBS = { ledger: "MANAGER-LEDGER.md", metrics: "MANAGER-METRICS.md" };
// git writes these at column 0: ours, the diff3 base, the separator, theirs
const MARKER = /^(<{7}|\|{7}|={7}|>{7})(\s|$)/;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lines = (text) => text.split(/\r?\n/);
const cellsOf = (line) => line.slice(1, line.lastIndexOf("|")).split("|").map((c) => c.trim());
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** One job file -> { id, ledger, metrics, errors }. `ledger` and `metrics` are the trimmed row lines, or null. */
export function parseJobFile(text, id) {
  const rel = `${DIR}/${id}.md`;
  const errors = [];
  lines(text).forEach((l, i) => {
    if (MARKER.test(l)) errors.push(`${rel}: unresolved merge conflict marker on line ${i + 1}: resolve it so the file holds one ledger row and one metrics row`);
  });
  const body = lines(text).map((l) => l.trim()).filter(Boolean);
  const job = { id, ledger: null, metrics: null, errors };
  let at = 0;
  const take = (head, what) => {
    if (body[at] !== head[0] || body[at + 1] !== head[1]) {
      errors.push(`${rel}: the ${what} table must start with the canonical header and separator lines, exactly: ${head[0]}`);
      return null;
    }
    const row = body[at + 2];
    at += 3;
    if (!row?.startsWith("|")) {
      errors.push(`${rel}: the ${what} table has its header but no row`);
      return null;
    }
    return row;
  };
  job.ledger = take(LEDGER_HEAD, "ledger");
  if (job.ledger === null) return job;
  const lid = cellsOf(job.ledger)[0];
  if (lid !== id) errors.push(`${rel}: ledger row is for "${lid}" but the file is ${id}.md`);
  if (/^\|\s*Job id\s*\|/i.test(body[at] ?? "")) {
    job.metrics = take(METRICS_HEAD, "metrics");
    if (job.metrics !== null) {
      const cells = cellsOf(job.metrics);
      if (cells.length !== 8) errors.push(`${rel}: metrics row has ${cells.length} cells, expected 8 (a stray | inside a cell?)`);
      else if (cells[0] !== id) errors.push(`${rel}: metrics row is for "${cells[0]}" but the file is ${id}.md`);
    }
  }
  if (at < body.length) errors.push(`${rel}: "${body[at].slice(0, 40)}": a job file holds the ledger row, then the metrics row, and nothing else`);
  return job;
}

/** Every file of docs/agent-os/ledger, parsed, in job id order. Throws when the directory cannot be read. */
export function loadJobs(root = REPO_ROOT, entries = readdirSync(join(root, DIR), { withFileTypes: true })) {
  const errors = [];
  const jobs = [];
  for (const e of entries) { // `entries` is a seam: a directory listing's order is the filesystem's, so a test hands in a reversed one
    const id = e.name.replace(/\.md$/, "");
    if (!e.isFile() || !e.name.endsWith(".md") || !JOB_ID.test(id)) {
      errors.push(`${DIR}/${e.name}: not a job file name: this directory holds only <yyyy-mm-dd-slug>.md files, one per job`);
      continue;
    }
    jobs.push(parseJobFile(readFileSync(join(root, DIR, e.name), "utf8"), id));
  }
  return { jobs: jobs.sort(byId), errors };
}

const stubText = (root, which) => readFileSync(join(root, "docs", "agent-os", STUBS[which]), "utf8");
const prose = (stub) => lines(stub).filter((l) => !l.trimStart().startsWith("|")).join("\n").replace(/\s+$/, "");
const view = (stub, head, rows) => `${prose(stub)}\n\n${head.join("\n")}\n${rows.map((r) => `${r}\n`).join("")}`;

/** The shared ledger table as the old file had it: the stub's prose, the header, one row per job in job id order. */
export function renderLedger(root = REPO_ROOT) {
  return view(stubText(root, "ledger"), LEDGER_HEAD, loadJobs(root).jobs.filter((j) => j.ledger).map((j) => j.ledger));
}

/** The metrics table: only jobs that have a metrics row. */
export function renderMetrics(root = REPO_ROOT) {
  return view(stubText(root, "metrics"), METRICS_HEAD, loadJobs(root).jobs.filter((j) => j.metrics).map((j) => j.metrics));
}

function stubProblems(text, file) {
  const ls = lines(text);
  const errors = [];
  const m = ls.findIndex((l) => MARKER.test(l));
  if (m >= 0) errors.push(`docs/agent-os/${file}: unresolved merge conflict marker on line ${m + 1}`);
  const t = ls.findIndex((l) => l.trimStart().startsWith("|"));
  if (t >= 0) errors.push(`docs/agent-os/${file} holds a table line (line ${t + 1}): rows live one per job in docs/agent-os/ledger/<job-id>.md; a row left here is never checked and brings back the conflict at the table's tail (ledger-migrate.mjs moves it)`);
  return errors;
}

/** The whole tree: the stubs, every job file, then every shared-table rule on the rendered ledger. */
export function ledgerRootProblems(root = REPO_ROOT) {
  const errors = Object.entries(STUBS).flatMap(([which, file]) => stubProblems(stubText(root, which), file));
  const { jobs, errors: nameErrors } = loadJobs(root);
  errors.push(...nameErrors, ...jobs.flatMap((j) => j.errors));
  const shared = ledgerProblems(view(stubText(root, "ledger"), LEDGER_HEAD, jobs.filter((j) => j.ledger).map((j) => j.ledger)));
  return { errors: [...errors, ...shared.errors], warnings: shared.warnings, rows: shared.rows };
}

/** The rows of one legacy shared table (the old MANAGER-LEDGER.md / MANAGER-METRICS.md), as a Map id -> row line. Throws on loss. */
function legacyRows(text, head, what) {
  const ls = lines(text);
  const h = ls.findIndex((l) => /^\s*\|\s*Job id\s*\|/i.test(l));
  if (h < 0) throw new Error(`${what}: no \`| Job id |\` header found`);
  if (ls[h].trim() !== head[0] || ls[h + 1]?.trim() !== head[1]) throw new Error(`${what}: the header is not the canonical one (${head[0]}): a column moved or was renamed, so the cells cannot be moved by position`);
  const rows = new Map();
  for (let i = h + 2; i < ls.length && ls[i].trimStart().startsWith("|"); i++) {
    const row = ls[i].trim();
    const cells = cellsOf(row);
    if (cells.length !== 8) throw new Error(`${cells[0] || row.slice(0, 40)}: ${cells.length} cells, expected 8 (a stray | inside a cell?)`);
    if (!JOB_ID.test(cells[0])) throw new Error(`${cells[0]}: job id must be yyyy-mm-dd-slug`);
    if (rows.has(cells[0])) throw new Error(`${cells[0]}: duplicate job id`);
    rows.set(cells[0], row);
  }
  return rows;
}

/** Legacy shared tables -> Map id -> the text of that job's file, in job id order. Throws rather than lose a row. */
export function migrateTables(ledgerText, metricsText = null) {
  const ledger = legacyRows(ledgerText, LEDGER_HEAD, "ledger");
  const metrics = metricsText === null ? new Map() : legacyRows(metricsText, METRICS_HEAD, "metrics");
  for (const id of metrics.keys()) if (!ledger.has(id)) throw new Error(`metrics row ${id} has no ledger row: add the ledger row first`);
  const files = new Map();
  for (const id of [...ledger.keys()].sort()) {
    const m = metrics.get(id);
    files.set(id, [...LEDGER_HEAD, ledger.get(id), ...(m ? ["", ...METRICS_HEAD, m] : []), ""].join("\n"));
  }
  return files;
}

if (isMainModule(import.meta.url)) {
  const i = process.argv.indexOf("--file");
  const root = resolve(arg("root", REPO_ROOT));
  const file = i > 0 ? resolve(process.argv[i + 1]) : null;
  let result;
  try {
    result = file ? ledgerProblems(readFileSync(file, "utf8")) : ledgerRootProblems(root);
  } catch (e) {
    console.error(`ledger-check: cannot read ${file ?? root}: ${String(e.message).split("\n")[0]}`);
    process.exit(2);
  }
  const { errors, warnings, rows } = result;
  for (const w of warnings) console.warn(`warn   ${w}`);
  for (const e of errors) console.error(`ERROR  ${e}`);
  console.log(`ledger-check: ${rows} rows, ${errors.length} errors, ${warnings.length} warnings`);
  process.exit(errors.length ? 1 : 0);
}
