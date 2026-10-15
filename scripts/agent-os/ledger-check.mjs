#!/usr/bin/env node
/**
 * Manager ledger hygiene check (2026-10-15).
 *
 * The ledger (docs/agent-os/MANAGER-LEDGER.md) is read by the next manager at session start. Four rows went stale
 * on 2026-10-15 because the PR / SHA cell held `pending (<branch>)` after the PR merged: nothing re-read the row.
 * A row can only reach main through its own PR's merge, so on main `pending` is always wrong. The fix is to write
 * the row as MERGED with the PR cell `this PR` in the PR that merges it; the number is one git command away:
 *   git log -S"<job id>" --format="%h %s" -- docs/agent-os/MANAGER-LEDGER.md
 *
 * The table is found by its `| Job id |` header and ends at the first line that is not a table row; prose above it is
 * ignored. Errors (exit 1): no header or separator, a header with no rows, a job row below the table's end (a blank line or
 * a prefix such as "> " or "- " hides it from the parser), a row without 8 cells, an unknown status, a malformed or
 * duplicate job id, an empty PR / SHA cell, `pending`/`TBD`/`TODO` in it. Warnings (exit 0): an open status (PLANNED,
 * RUNNING, BUILT) with `this PR` (true only after the merge, when the status is already wrong) or with a PR cell that
 * says MERGED. Exit 2: the file cannot be read.
 *
 * Run: node scripts/agent-os/ledger-check.mjs [--file <path>]
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./cli-common.mjs";

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

if (isMainModule(import.meta.url)) {
  const i = process.argv.indexOf("--file");
  const file = i > 0 ? resolve(process.argv[i + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "agent-os", "MANAGER-LEDGER.md");
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    console.error(`ledger-check: cannot read ${file}: ${String(e.message).split("\n")[0]}`);
    process.exit(2);
  }
  const { errors, warnings, rows } = ledgerProblems(text);
  for (const w of warnings) console.warn(`warn   ${w}`);
  for (const e of errors) console.error(`ERROR  ${e}`);
  console.log(`ledger-check: ${rows} rows, ${errors.length} errors, ${warnings.length} warnings`);
  process.exit(errors.length ? 1 : 0);
}
