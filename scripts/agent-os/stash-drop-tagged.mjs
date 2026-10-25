#!/usr/bin/env node
/**
 * stash-drop-tagged.mjs <tag>  (2026-10-25, job no-permission-rules)
 *
 * The stash is shared by every worktree on this machine, so rule stash-pop denies a raw drop or clear: an index
 * like stash@{1} names whatever a sibling pushed last. A session may drop only an entry IT tagged, with
 * `git stash push -u -m "<manager-...|session-...>"`. This script finds that entry by its full tag and drops it:
 * - refuses (exit 2) a tag without the manager- or session- prefix, or with spaces or a leading dash;
 * - refuses when no entry, or more than one, carries exactly that tag (a prefix of a longer tag never matches);
 * - drops the entry and checks the dropped SHA is the one it found; if a sibling shifted the stack in between,
 *   exits 1 and prints the `git stash store` line that puts the dropped entry back.
 */
import { spawnSync } from "node:child_process";

const TAG = /^(?:manager|session)-[A-Za-z0-9._-]+$/;
function git(args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}
function refuse(msg) {
  process.stderr.write(`[stash-drop-tagged] REFUSED: ${msg}\n`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const tag = argv[0] ?? "";
if (argv.length !== 1 || !tag || tag.startsWith("-") || /\s/.test(tag)) refuse("usage: stash-drop-tagged.mjs <tag>");
if (!TAG.test(tag)) refuse(`"${tag}" does not start with manager- or session-; drop only an entry you tagged`);

const list = git(["stash", "list", "--format=%gd%x00%H%x00%gs"]);
if (list.code !== 0) refuse(`git stash list failed: ${list.err.trim()}`);
// `git stash push -m <tag>` stores the subject "On <branch>: <tag>".
const hits = list.out
  .split("\n")
  .filter(Boolean)
  .map((line) => line.split("\0"))
  .filter(([, , subject]) => subject === tag || subject.endsWith(`: ${tag}`));
if (hits.length === 0) refuse(`no stash entry carries the tag ${tag}`);
if (hits.length > 1) refuse(`${hits.length} entries carry the tag ${tag}; drop by hand after reading git stash list`);

const [ref, sha, subject] = hits[0];
const drop = git(["stash", "drop", ref]);
if (drop.code !== 0) {
  process.stderr.write(`[stash-drop-tagged] git stash drop ${ref} failed: ${drop.err.trim()}\n`);
  process.exit(1);
}
const dropped = /\(([0-9a-f]{7,40})\)/.exec(drop.out)?.[1] ?? "";
if (!dropped || !sha.startsWith(dropped)) {
  process.stderr.write(
    `[stash-drop-tagged] the stack moved: ${ref} was ${dropped || "unknown"}, not ${sha}. Put it back with: ` +
      `git stash store -m "<its message>" ${dropped || "<sha from git fsck --unreachable>"}\n`,
  );
  process.exit(1);
}
console.log(`[stash-drop-tagged] dropped ${ref} "${subject}" ${sha}`);
