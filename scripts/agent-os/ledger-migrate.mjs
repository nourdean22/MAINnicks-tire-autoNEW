#!/usr/bin/env node
/**
 * Move rows from the OLD shared tables into per-job files (2026-10-16).
 *
 * Used once to split the 48-row ledger and the metrics table, and again by any branch that still appended its row to
 * the old MANAGER-LEDGER.md / MANAGER-METRICS.md before the split reached main. After rebasing onto the split:
 *
 *   git show <your-branch>:docs/agent-os/MANAGER-LEDGER.md > old-ledger.md       (and the same for MANAGER-METRICS.md)
 *   node scripts/agent-os/ledger-migrate.mjs --ledger old-ledger.md --metrics old-metrics.md --only <your-job-id>
 *
 * Cells are copied byte for byte, never reworded. A file that already exists is skipped unless --force. It throws
 * rather than lose data: a drifted header, a row without 8 cells, a duplicate id, a metrics row with no ledger row.
 *
 *   --ledger <file>   required: text holding the old ledger table
 *   --metrics <file>  optional: text holding the old metrics table
 *   --out <dir>       default docs/agent-os/ledger
 *   --only a,b        only these job ids (an id the tables do not hold is an error, never a silent zero)
 *   --force           overwrite files that exist
 *
 * Exit 64: usage. Exit 2: an input cannot be read or cannot be moved without loss.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { arg, flag, isMainModule } from "./cli-common.mjs";
import { migrateTables } from "./ledger-check.mjs";

if (isMainModule(import.meta.url)) {
  const ledgerPath = arg("ledger");
  if (!ledgerPath) {
    console.error("usage: node scripts/agent-os/ledger-migrate.mjs --ledger <old MANAGER-LEDGER.md> [--metrics <old MANAGER-METRICS.md>] [--out <dir>] [--only id,id] [--force]");
    process.exit(64);
  }
  const out = resolve(arg("out", join(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), "docs", "agent-os", "ledger")));
  let files;
  try {
    files = migrateTables(readFileSync(resolve(ledgerPath), "utf8"), arg("metrics") ? readFileSync(resolve(arg("metrics")), "utf8") : null);
  } catch (e) {
    console.error(`ledger-migrate: ${String(e.message).split("\n")[0]}`);
    process.exit(2);
  }
  const only = arg("only") ? arg("only").split(",").map((s) => s.trim()).filter(Boolean) : null;
  const unknown = (only ?? []).filter((id) => !files.has(id));
  if (unknown.length) {
    console.error(`ledger-migrate: not in the ledger table: ${unknown.join(", ")}`);
    process.exit(64);
  }
  mkdirSync(out, { recursive: true });
  let wrote = 0;
  let skipped = 0;
  for (const [id, text] of files) {
    if (only && !only.includes(id)) continue;
    const target = join(out, `${id}.md`);
    if (existsSync(target) && !flag("force")) {
      skipped++;
      continue;
    }
    writeFileSync(target, text);
    wrote++;
  }
  console.log(`ledger-migrate: wrote ${wrote}, skipped ${skipped} (${out})`);
}
