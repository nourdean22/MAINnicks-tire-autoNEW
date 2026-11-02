#!/usr/bin/env node
/**
 * Print statenour's reconciliation entries newest first (2026-11-02, job 2026-11-02-platform-forever-fixes).
 *
 * Every PR used to insert its entry at line 3 of apps/statenour/docs/RECONCILIATION.md, so any two open PRs conflicted
 * there (PRs 3500, 3504, 3506, 3507 and 3508 went DIRTY against each other five times on 2026-11-01/02). Since then each
 * PR adds its own file, apps/statenour/docs/reconciliation/<YYYY-MM-DD>-<slug>.md, in the same blockquote format; the
 * entries up to 2026-11-02 stay in RECONCILIATION.md. Same pattern as docs/agent-os/ledger/ + ledger-render.mjs.
 *
 *   node scripts/agent-os/reconciliation-render.mjs            every entry in full, newest first
 *   node scripts/agent-os/reconciliation-render.mjs --list     one line per entry: file and header
 *   node scripts/agent-os/reconciliation-render.mjs --tail 3   only the newest 3
 *   --root <dir>                                               another repo root (default: this repo)
 *
 * Exit 1: a file in the folder is misnamed, or its first line is not "> ## <the file's date> ..." (named in the output).
 * Exit 2: the folder cannot be read. Exit 64: a bad flag.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { arg, flag, isMainModule } from "./cli-common.mjs";

export const RECON_DIR = join("apps", "statenour", "docs", "reconciliation");
const NAME = /^(\d{4}-\d{2}-\d{2})-[a-z0-9][a-z0-9-]*\.md$/;

/** Entries newest first (file name descending: the date leads it), plus a problem line per malformed file. */
export function loadEntries(root) {
  const entries = [];
  const problems = [];
  for (const name of readdirSync(join(root, RECON_DIR)).sort().reverse()) {
    const date = NAME.exec(name)?.[1];
    if (!date) {
      problems.push(`${name}: name must be <YYYY-MM-DD>-<lowercase-slug>.md`);
      continue;
    }
    let text;
    try {
      text = readFileSync(join(root, RECON_DIR, name), "utf8").replace(/\r\n/g, "\n").trim();
    } catch (e) {
      problems.push(`${name}: unreadable (${String(e.message).split("\n")[0]})`); // one bad file never hides the others
      continue;
    }
    const header = text.split("\n")[0];
    if (!new RegExp(`^>\\s*##\\s+${date}\\b`).test(header)) problems.push(`${name}: first line must be "> ## ${date} · <title>", got "${header.slice(0, 80)}"`);
    else entries.push({ name, header, text });
  }
  return { entries, problems };
}

if (isMainModule(import.meta.url)) {
  const root = resolve(arg("root", resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")));
  const tailArg = arg("tail");
  const tail = tailArg === null ? Infinity : /^[1-9]\d*$/.test(tailArg) ? Number(tailArg) : NaN;
  if (Number.isNaN(tail)) {
    console.error(`reconciliation-render: --tail wants a positive whole number, got "${tailArg}"`);
    process.exit(64);
  }
  let loaded;
  try {
    loaded = loadEntries(root);
  } catch (e) {
    console.error(`reconciliation-render: cannot read ${join(root, RECON_DIR)}: ${String(e.message).split("\n")[0]}`);
    process.exit(2);
  }
  for (const p of loaded.problems) console.error(`reconciliation-render: ${p}`);
  const shown = loaded.entries.slice(0, tail);
  process.stdout.write(flag("list") ? shown.map((e) => `${e.name}  ${e.header}\n`).join("") : shown.map((e) => `${e.text}\n`).join("\n"));
  if (loaded.problems.length) process.exit(1);
}
