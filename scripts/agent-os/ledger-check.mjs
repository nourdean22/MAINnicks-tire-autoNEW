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
 * Errors (exit 1): a row without 8 cells, an unknown status, a malformed or duplicate job id, `pending`/`TBD`/`TODO`
 * in the PR / SHA cell. Warning (exit 0): an open status (PLANNED, RUNNING, BUILT) with `this PR`, which is true
 * only after the merge, when the status is already wrong.
 *
 * Run: node scripts/agent-os/ledger-check.mjs [--file <path>]
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  const rows = lines.filter(isRow).map((l) => l.trim()).slice(2); // indented rows count; drop the header and the separator
  // A line that carries a job id between pipes but does not start with one would be skipped without a word.
  for (const l of lines) if (!isRow(l) && /\|\s*\d{4}-\d{2}-\d{2}-[a-z0-9-]+\s*\|/.test(l)) errors.push(`${l.slice(0, 40)}: looks like a job row but does not start with "|": not parsed`);
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
    if (STALE.test(pr)) errors.push(`${id}: PR / SHA cell says "${pr.match(STALE)[0]}". A row on main got there by its merge: write "this PR", a number, or "none"`);
    if (OPEN.has(status) && /\bthis PR\b/i.test(pr)) warnings.push(`${id}: ${status} with "this PR" is true only after the merge, when the status is stale: write MERGED`);
  }
  return { errors, warnings, rows: rows.length };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const i = process.argv.indexOf("--file");
  const file = i > 0 ? resolve(process.argv[i + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "agent-os", "MANAGER-LEDGER.md");
  const { errors, warnings, rows } = ledgerProblems(readFileSync(file, "utf8"));
  for (const w of warnings) console.warn(`warn   ${w}`);
  for (const e of errors) console.error(`ERROR  ${e}`);
  console.log(`ledger-check: ${rows} rows, ${errors.length} errors, ${warnings.length} warnings`);
  process.exit(errors.length ? 1 : 0);
}
