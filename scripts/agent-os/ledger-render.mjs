#!/usr/bin/env node
/**
 * Print the manager ledger or the job metrics as one table (2026-10-16).
 *
 * The tables are not stored: each job owns docs/agent-os/ledger/<job-id>.md (see ledger-check.mjs), so two PRs never
 * edit the same line. This reads the files and prints the table the old MANAGER-LEDGER.md / MANAGER-METRICS.md held,
 * rows in job id order (which is date order), deterministic.
 *
 *   node scripts/agent-os/ledger-render.mjs                 the ledger: prose, header, every row
 *   node scripts/agent-os/ledger-render.mjs --metrics       the metrics table
 *   node scripts/agent-os/ledger-render.mjs --open          only rows whose Status is not MERGED or CANCELLED
 *   node scripts/agent-os/ledger-render.mjs --tail 5        only the last 5 rows
 *   node scripts/agent-os/ledger-render.mjs --open --tail 5 both, as a union (manager step 1)
 *   --root <dir>                                            another repo root (default: this repo)
 *
 * Exit 64: a bad flag. Exit 2: the ledger directory or a stub cannot be read.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { arg, flag, isMainModule } from "./cli-common.mjs";
import { LEDGER_HEAD, METRICS_HEAD, loadJobs, renderLedger, renderMetrics } from "./ledger-check.mjs";

const STATUS_CELL = 4;
const CLOSED = new Set(["MERGED", "CANCELLED"]);

if (isMainModule(import.meta.url)) {
  const root = resolve(arg("root", resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")));
  const metrics = flag("metrics");
  const open = flag("open");
  const tailArg = arg("tail");
  const tail = tailArg === null ? null : /^[1-9]\d*$/.test(tailArg) ? Number(tailArg) : NaN;
  if (Number.isNaN(tail) || (open && metrics)) {
    console.error(open && metrics ? "ledger-render: --open reads Status, which only the ledger has; drop --metrics" : `ledger-render: --tail wants a positive whole number, got "${tailArg}"`);
    process.exit(64);
  }
  try {
    if (!open && tail === null) {
      process.stdout.write(metrics ? renderMetrics(root) : renderLedger(root));
    } else {
      const rows = loadJobs(root).jobs.map((j) => (metrics ? j.metrics : j.ledger)).filter(Boolean);
      const keep = rows.filter((row, i) => (open && !CLOSED.has(row.slice(1, row.lastIndexOf("|")).split("|")[STATUS_CELL].trim())) || (tail !== null && i >= rows.length - tail));
      process.stdout.write(`${(metrics ? METRICS_HEAD : LEDGER_HEAD).join("\n")}\n${keep.map((r) => `${r}\n`).join("")}`);
    }
  } catch (e) {
    console.error(`ledger-render: cannot read ${root}: ${String(e.message).split("\n")[0]}`);
    process.exit(2);
  }
}
