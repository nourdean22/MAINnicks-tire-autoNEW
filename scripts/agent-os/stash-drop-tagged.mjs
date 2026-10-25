#!/usr/bin/env node
/**
 * stash-drop-tagged.mjs <tag>  (2026-10-25, job no-permission-rules)
 *
 * The stash is shared by every worktree on this machine, so rule stash-pop denies a raw drop or clear: an index
 * like stash@{1} names whatever a sibling pushed last. A session may drop only an entry IT tagged, with
 * `git stash push -u -m "<manager-...|session-...>"`. This script finds that entry by its full tag and drops it:
 * - refuses (exit 2) a tag without the manager- or session- prefix, or with spaces or a leading dash;
 * - refuses when no entry, or more than one, carries exactly that tag as its whole message (a prefix of a longer
 *   tag, or a message that only ends with it, never matches);
 * - right before the drop, re-lists, finds the entry by its SHA (a sibling's push shifts every index), checks
 *   `git rev-parse stash@{N}` is that SHA, and drops only that verified index;
 * - checks the dropped SHA afterwards too; if the stack still moved in the last instant, exits 1 and prints the
 *   `git stash store` line that puts the dropped entry back.
 * Limit: git has no compare-and-drop, so the instant between the rev-parse and the drop stays open; the
 * after-check plus the store line covers it.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TAG = /^(?:manager|session)-[A-Za-z0-9._-]+$/;
function realGit(args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

// `git stash push -m <tag>` stores the subject "On <branch>: <tag>". Strip that ONE prefix (a ref name cannot hold
// a colon) and compare the whole message: "sibling-note: session-x" is a sibling's message, not the tag session-x.
const message = (subject) => subject.replace(/^On [^:]+: /, "");

/** Returns { code, msg }: 0 dropped, 1 drop failed or the stack moved, 2 refused. `git` is injectable for tests. */
export function dropTagged(tag, git = realGit) {
  const refuse = (msg) => ({ code: 2, msg: `[stash-drop-tagged] REFUSED: ${msg}` });
  if (!tag || tag.startsWith("-") || /\s/.test(tag)) return refuse("usage: stash-drop-tagged.mjs <tag>");
  if (!TAG.test(tag)) return refuse(`"${tag}" does not start with manager- or session-; drop only an entry you tagged`);

  let failed = "";
  const list = () => {
    const r = git(["stash", "list", "--format=%gd%x00%H%x00%gs"]);
    if (r.code !== 0) failed = r.err.trim() || "git stash list failed";
    return r.code !== 0 ? [] : r.out.split("\n").filter(Boolean).map((line) => line.split("\0"));
  };
  const hits = list().filter(([, , subject]) => message(subject) === tag);
  if (failed) return refuse(`git stash list failed: ${failed}`);
  if (hits.length === 0) return refuse(`no stash entry carries the tag ${tag}`);
  if (hits.length > 1) return refuse(`${hits.length} entries carry the tag ${tag}; drop by hand after reading git stash list`);
  const [ref, sha, subject] = hits[0];

  // Re-resolve by SHA immediately before the drop: the index from the first list may now name a sibling's entry.
  const live = list().find(([, h]) => h === sha);
  if (!live) return { code: 1, msg: `[stash-drop-tagged] ${sha} (${ref}) is no longer in the stash; nothing dropped` };
  const [liveRef] = live;
  const at = git(["rev-parse", "--verify", liveRef]);
  if (at.code !== 0 || at.out.trim() !== sha) {
    return { code: 1, msg: `[stash-drop-tagged] ${liveRef} is no longer ${sha} (the stack moved); nothing dropped, run again` };
  }
  const drop = git(["stash", "drop", liveRef]);
  if (drop.code !== 0) return { code: 1, msg: `[stash-drop-tagged] git stash drop ${liveRef} failed: ${drop.err.trim()}` };
  const dropped = /\(([0-9a-f]{7,40})\)/.exec(drop.out)?.[1] ?? "";
  if (!dropped || !sha.startsWith(dropped)) {
    return {
      code: 1,
      msg:
        `[stash-drop-tagged] the stack moved: ${liveRef} was ${dropped || "unknown"}, not ${sha}. Put it back with: ` +
        `git stash store -m "<its message>" ${dropped || "<sha from git fsck --unreachable>"}`,
    };
  }
  return { code: 0, msg: `[stash-drop-tagged] dropped ${liveRef} "${subject}" ${sha}` };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const r = argv.length === 1 ? dropTagged(argv[0]) : { code: 2, msg: "[stash-drop-tagged] REFUSED: usage: stash-drop-tagged.mjs <tag>" };
  (r.code === 0 ? process.stdout : process.stderr).write(`${r.msg}\n`);
  process.exit(r.code);
}
