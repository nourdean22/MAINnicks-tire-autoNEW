#!/usr/bin/env node
/**
 * Shared-deps check (SessionStart, startup). Prints ONE line about the PRIMARY checkout's node_modules,
 * the tree every junctioned worktree points at:
 *   [deps] OK (N workspaces, M deps)          every direct dep of every workspace resolves
 *   [deps] FAILED: <ws> missing <a>, <b>; ...  names what is gone and the fix
 *   [deps] UNKNOWN: <why>                     the check could not measure; never rounded to OK
 *
 * Why (2026-10-17): a filtered `pnpm add` in the primary pruned vite from the shared store and every worktree's
 * nickstire tsc and vitest broke at once; it was found by hand. Rule shared-deps-mutation now blocks that command;
 * this line reports the state whatever caused it.
 *
 * Scope: the root, apps/*, packages/* that hold a package.json. Direct deps = dependencies + devDependencies
 * (optional ones may be absent by platform). A dep resolves when <dir>/node_modules/<name>/package.json exists in
 * the workspace or an ancestor up to the repo root, as node walks up; existsSync follows junctions. No network,
 * no install, no git spawn. Fail open: always exit 0, the line is the signal.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FIX =
  "the primary's node_modules is out of sync with the lockfile; run a full pnpm install --frozen-lockfile in the primary (no --filter) when no sibling session is mid-run";

/** The primary checkout for `dir`: a worktree's .git FILE names <primary>/.git/worktrees/<name>. */
export function findPrimary(dir) {
  const git = join(dir, ".git");
  if (existsSync(git) && statSync(git).isFile()) {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(git, "utf8"));
    const at = m ? m[1].replace(/\\/g, "/").lastIndexOf("/.git/worktrees/") : -1;
    if (at > 0) return m[1].slice(0, at);
  }
  return dir;
}

function workspaces(root) {
  const out = [root];
  for (const group of ["apps", "packages"]) {
    const base = join(root, group);
    if (!existsSync(base)) continue;
    for (const e of readdirSync(base, { withFileTypes: true })) {
      if (e.isDirectory() && existsSync(join(base, e.name, "package.json"))) out.push(join(base, e.name));
    }
  }
  return out;
}

function resolves(ws, root, name) {
  for (let d = ws; ; d = dirname(d)) {
    if (existsSync(join(d, "node_modules", name, "package.json"))) return true;
    if (d === root || dirname(d) === d) return false;
  }
}

/** @returns {{state: "OK"|"FAILED"|"UNKNOWN", line: string}} */
export function checkDeps(root) {
  root = resolve(root);
  try {
    if (!existsSync(join(root, "package.json"))) return unknown(`no package.json at ${root}`);
    const dirs = workspaces(root);
    if (!dirs.some((d) => existsSync(join(d, "node_modules")))) return unknown(`${root} has no node_modules at all (never installed?)`);
    let deps = 0;
    const missing = [];
    for (const ws of dirs) {
      const file = join(ws, "package.json");
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(file, "utf8"));
      } catch (err) {
        return unknown(`cannot read ${relative(root, file).replace(/\\/g, "/")}: ${err.message}`);
      }
      const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      deps += names.length;
      const gone = names.filter((n) => !resolves(ws, root, n));
      if (gone.length) missing.push(`${relative(root, ws).replace(/\\/g, "/") || "root"} missing ${gone.join(", ")}`);
    }
    if (missing.length) return { state: "FAILED", line: `[deps] FAILED: ${missing.join("; ")}; ${FIX}` };
    return { state: "OK", line: `[deps] OK (${dirs.length} workspaces, ${deps} deps)` };
  } catch (err) {
    return unknown(err?.message ?? String(err));
  }
}

const unknown = (why) => ({ state: "UNKNOWN", line: `[deps] UNKNOWN: ${why}` });

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let line;
  try {
    line = checkDeps(process.argv[2] ?? findPrimary(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."))).line;
  } catch (err) {
    line = `[deps] UNKNOWN: ${err?.message ?? err}`;
  }
  process.stdout.write(`${line}\n`);
  process.exit(0);
}
