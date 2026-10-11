#!/usr/bin/env node
/**
 * Lane path check (2026-10-11): "edit only your owned paths" as a gate, not a sentence.
 *
 *   node scripts/agent-os/check-lane-paths.mjs --lane <lane> --base <ref> [--head <ref>]
 *
 * Owned globs come from the `ownedPaths:` frontmatter of .claude/agents/lane-<lane>.md in THIS
 * script's checkout (the manager's), never from the diff under review. Git runs in the cwd (the
 * lane's worktree).
 *   --head given: committed diff `base...head` (merge-base, so main moving ahead adds nothing).
 *   --head omitted: merge-base(base, HEAD) against the WORKING TREE plus untracked files, so an
 *   uncommitted out-of-lane edit is caught too.
 * Renames are split (--no-renames): moving a file OUT of another lane touches that lane's path.
 * Exit 0 = every changed path owned · 1 = out-of-lane paths (each named) · 2 = anything else
 * (usage, unknown lane, missing ownedPaths, git error): an error never reads as pass OR as a finding.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./cli-common.mjs";
import { stripGitLocalEnv } from "./gitLocalEnv.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const AGENTS_DIR = join(ROOT, ".claude", "agents");

/** Parse the `ownedPaths:` list (block list of quoted strings, or `[]`) from YAML frontmatter. */
export function parseOwnedPaths(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const i = lines.findIndex((l) => /^ownedPaths:/.test(l));
  if (i === -1) return null;
  if (/^ownedPaths:\s*\[\]\s*$/.test(lines[i])) return [];
  const out = [];
  for (const l of lines.slice(i + 1)) {
    const item = /^\s+-\s+"([^"]+)"\s*$/.exec(l);
    if (!item) break;
    out.push(item[1]);
  }
  return out;
}

export function readOwnedPaths(lane, agentsDir = AGENTS_DIR) {
  if (!/^[a-z0-9-]+$/.test(lane)) throw new Error(`invalid lane name "${lane}"`);
  const file = join(agentsDir, `lane-${lane}.md`);
  if (!existsSync(file)) throw new Error(`unknown lane "${lane}" (no ${file})`);
  const globs = parseOwnedPaths(readFileSync(file, "utf8"));
  if (globs === null) throw new Error(`${file} has no ownedPaths: frontmatter`);
  return globs;
}

/** Tiny glob: `**` = any chars incl. `/`, `*` = any chars except `/`. Whole-path, case-sensitive. */
export function globToRegExp(glob) {
  const body = glob
    .split("**")
    .map((part) => part.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
    .join(".*");
  return new RegExp(`^${body}$`);
}

export function offendingPaths(paths, globs) {
  const res = globs.map(globToRegExp);
  return paths.filter((p) => !res.some((re) => re.test(p)));
}

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: stripGitLocalEnv(process.env) });
  if (r.error || r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || r.error?.message || "").trim()}`);
  }
  return r.stdout;
}

const nul = (s) => s.split("\0").filter(Boolean);

export function changedPaths({ base, head, cwd = process.cwd() }) {
  if (head) return nul(git(["diff", "--name-only", "--no-renames", "-z", `${base}...${head}`], cwd));
  const mb = git(["merge-base", base, "HEAD"], cwd).trim();
  const tracked = nul(git(["diff", "--name-only", "--no-renames", "-z", mb], cwd));
  const untracked = nul(git(["ls-files", "--others", "--exclude-standard", "-z"], cwd));
  return [...new Set([...tracked, ...untracked])].sort();
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!["--lane", "--base", "--head"].includes(k) || argv[i + 1] === undefined) {
      throw new Error(`usage: check-lane-paths.mjs --lane <lane> --base <ref> [--head <ref>]`);
    }
    a[k.slice(2)] = argv[i + 1];
  }
  if (!a.lane || !a.base) throw new Error("--lane and --base are required");
  return a;
}

export function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  try {
    const { lane, base, head } = parseArgs(argv);
    const globs = readOwnedPaths(lane);
    const paths = changedPaths({ base, head, cwd });
    const bad = offendingPaths(paths, globs);
    const range = head ? `${base}...${head}` : `${base}...working tree`;
    if (bad.length) {
      console.error(`[lane-paths] FAIL lane ${lane}: ${bad.length} of ${paths.length} changed path(s) outside owned globs (${range}):`);
      for (const p of bad) console.error(`  OUT-OF-LANE ${p}`);
      return 1;
    }
    console.log(`[lane-paths] OK lane ${lane}: ${paths.length} changed path(s), all owned (${range})`);
    return 0;
  } catch (err) {
    console.error(`[lane-paths] ERROR ${err.message}`);
    return 2;
  }
}

if (isMainModule(import.meta.url)) process.exit(main());
