#!/usr/bin/env node
/**
 * check-memory-index — guard the agent-memory index against SILENT truncation.
 *
 * THE DEFECT THIS EXISTS FOR. `MEMORY.md` is loaded into every session. Past a
 * read limit (~24,400 bytes observed) it truncates, and a truncated index and a
 * complete one render identically: a list of memories. Nothing distinguishes
 * them, so the entries past the cut — the OLDEST ACTIVE ones, at the bottom —
 * become invisible while every session reports fine. That is shape 4 (the blind
 * instrument) inside the memory system itself, and it has already happened once:
 * the index header records a 2026-08-19 compaction done because "tail entries
 * were invisible".
 *
 * WHY IT IS NOT A REPO GATE. The memory directory is MACHINE-LOCAL
 * (`~/.claude/projects/<slug>/memory/`) and is not in any checkout. CI cannot
 * see it, lefthook cannot see it, and `pnpm agent:verify` cannot see it. A
 * SessionStart hook is the only surface that runs on the machine that holds the
 * file. This script is therefore written to be hook-invoked, not CI-invoked.
 *
 * WHAT IT CHECKS — three things, in descending order of severity:
 *
 *   1. TRUNCATION SENTINEL. The last non-empty line must be the INDEX-END
 *      marker. If the file ends anywhere else, either the sentinel was dropped
 *      or entries were appended after it — both mean the marker can no longer
 *      prove a complete read.
 *   2. HEADROOM. Warn past WARN_PCT, fail past FAIL_PCT. Compaction has already
 *      been spent twice (2026-08-19, 2026-08-23); the remedy past the warn line
 *      is to MOVE the oldest active entries into the second-level index, not to
 *      shorten sentences again.
 *   3. REACHABILITY. Every topic file must be referenced by MEMORY.md or by the
 *      second-level settled-index.md. A memory nothing points at is written,
 *      stored, and never recalled — the orphaned-subject shape. One such file
 *      was found on 2026-08-23 (`statenour-chat-audit-2026-07-04.md`), reachable
 *      from neither index, and nothing had reported it.
 *
 * EXIT CODES: 0 clean · 1 a check failed · 2 the guard could not run (directory
 * missing, unreadable). NEVER exits 0 on "I could not look" — a guard that fails
 * open prints the same green as a healthy index, which is the defect it guards.
 *
 * Usage:
 *   node scripts/agent-os/check-memory-index.mjs
 *   node scripts/agent-os/check-memory-index.mjs --dir <path>   # override
 *   node scripts/agent-os/check-memory-index.mjs --quiet        # only on problems
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

/**
 * `--limit <bytes>` exists FOR THE CANARIES, and that is a design decision, not
 * a convenience.
 *
 * Without it, a fixture proving the fail-threshold has to be sized against the
 * live READ_LIMIT — so the canary silently depends on a constant it does not
 * own. Move the limit for a good reason and the canary fails while the guard is
 * correct, which is how a control ends up deleted instead of fixed. A test must
 * assert against a fixture it controls end to end, including the threshold.
 */
const argLimit = process.argv.indexOf("--limit");
const READ_LIMIT = argLimit !== -1 ? Number(process.argv[argLimit + 1]) : 24_400; // observed truncation point
const WARN_PCT = 80;
const FAIL_PCT = 92;

if (!Number.isFinite(READ_LIMIT) || READ_LIMIT <= 0) {
  console.error(`[memory-index] CANNOT CHECK: --limit must be a positive number, got ${process.argv[argLimit + 1]}`);
  process.exit(2);
}

const argDir = process.argv.indexOf("--dir");
const QUIET = process.argv.includes("--quiet");

/**
 * DERIVE the project slug; do not hard-code it.
 *
 * The first version wrote `C--Users-nourd-NOURCITY` as a literal — one
 * machine's path, baked into a repo file. That is the same coupling this
 * repo now has a rule against: a control bound to a datum that can
 * legitimately change (a moved checkout, a second machine, a renamed drive).
 * It fails SAFE here — a wrong slug exits 2, "CANNOT CHECK", never 0 — but
 * "fails loudly on every session for a reason nobody can act on" is how a
 * guard gets disabled.
 *
 * The harness builds the slug by replacing path separators and `:` with `-`.
 */
function projectSlug(repoRoot) {
  return repoRoot.replace(/[\\/:]/g, "-");
}
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR =
  argDir !== -1
    ? process.argv[argDir + 1]
    : join(homedir(), ".claude", "projects", projectSlug(REPO_ROOT), "memory");

function bail(msg) {
  console.error(`[memory-index] CANNOT CHECK: ${msg}`);
  console.error("  Exiting 2, not 0 — a guard that cannot see its subject must not report health.");
  process.exit(2);
}

if (!existsSync(DIR) || !statSync(DIR).isDirectory()) bail(`${DIR} is not a directory`);
const INDEX = join(DIR, "MEMORY.md");
if (!existsSync(INDEX)) bail(`${INDEX} does not exist`);

let index;
try {
  index = readFileSync(INDEX, "utf8");
} catch (err) {
  bail(`cannot read ${INDEX}: ${err.message}`);
}

const bytes = Buffer.byteLength(index, "utf8");
const pct = (bytes / READ_LIMIT) * 100;
const problems = [];

/*
 * 1 · SENTINEL — it must be the ACTUAL INDEX-END comment, not merely "the file
 * ends with a comment".
 *
 * Raised in review against the first draft, which tested the last LINE for
 * `INDEX-END` OR a trailing `-->`. The `-->` alternative existed so the
 * multiline sentinel would pass — its last line ends the comment without
 * repeating the marker — and it accepted ANY trailing HTML comment. Delete
 * INDEX-END, leave any other comment last, and the guard printed "sentinel
 * present". A truncation check that a stray comment satisfies is precisely the
 * shape it guards against, shipped inside the guard.
 *
 * Corrected: find the LAST comment block and require INDEX-END inside it.
 */
const trimmedIndex = index.trimEnd();
const lastCommentOpen = trimmedIndex.lastIndexOf("<!--");
const lastComment = lastCommentOpen === -1 ? "" : trimmedIndex.slice(lastCommentOpen);
if (!trimmedIndex.endsWith("-->") || !lastComment.includes("INDEX-END")) {
  problems.push(
    "the INDEX-END sentinel is not the last thing in the file. Either it was removed, or entries " +
      "were appended after it — either way it can no longer prove the index was read whole.",
  );
}

// 2 · HEADROOM
if (pct >= FAIL_PCT) {
  problems.push(
    `index is ${bytes} bytes = ${pct.toFixed(1)}% of the ~${READ_LIMIT}-byte read limit. ` +
      "Past this point truncation is imminent and SILENT. Move the oldest ACTIVE entries into " +
      "settled-index.md — do not compact sentences again; that has been spent twice already.",
  );
} else if (pct >= WARN_PCT) {
  // NOT gated on QUIET. --quiet suppresses the HEALTHY summary only; a capacity
  // warning is the whole early-warning value of the hook, and the documented
  // install command uses --quiet. The first draft gated this too, which would
  // have meant the operator first heard about capacity when the guard FAILED at
  // 92% -- an early-warning system that only speaks once it is too late, inside
  // the guard written against exactly that failure.
  console.warn(
    `[memory-index] WARNING ${bytes} bytes = ${pct.toFixed(1)}% of ~${READ_LIMIT}. ` +
      `Headroom ${READ_LIMIT - bytes} bytes. Plan the migration to settled-index.md now, ` +
      "while it is cheap.",
  );
}

// 3 · REACHABILITY
let topicFiles;
try {
  topicFiles = readdirSync(DIR).filter(
    (f) => f.endsWith(".md") && f !== "MEMORY.md" && f !== "settled-index.md" && !f.startsWith("_bak_"),
  );
} catch (err) {
  bail(`cannot list ${DIR}: ${err.message}`);
}
const settledPath = join(DIR, "settled-index.md");
const settled = existsSync(settledPath) ? readFileSync(settledPath, "utf8") : "";
const orphans = topicFiles.filter((f) => !index.includes(`(${f})`) && !settled.includes(`(${f})`));
if (orphans.length) {
  problems.push(
    `${orphans.length} memory file(s) are referenced by NO index and can never be recalled: ` +
      orphans.slice(0, 8).join(", ") +
      (orphans.length > 8 ? ` … +${orphans.length - 8} more` : ""),
  );
}

if (problems.length) {
  console.error(`\n[memory-index] ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  ✗ ${p}\n`);
  process.exit(1);
}

if (!QUIET) {
  console.log(
    `[memory-index] ok — ${bytes} bytes (${pct.toFixed(1)}% of ~${READ_LIMIT}), ` +
      `${topicFiles.length} topic files, all reachable, sentinel present.`,
  );
}
