/**
 * scripts/check-memory-admission.ts — the memory admission ratchet (2026-09-18).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 * ════════════════════════════════════════════════════════════════════════════
 * `brainMemory.remember()` is the admission gate: it is where provenance,
 * confidence, supersession and category policy are applied to a durable belief.
 * Measured 2026-09-18: **172 direct write call sites across 123 files** bypass
 * it entirely, against 119 `remember()` sites. There is NO existing allowlist
 * or gate on the write side (the only brainMemory gate in the repo fences
 * prompt READS).
 *
 * This is NOT a refactor of those 123 files. Rewriting that many call sites in
 * one pass is how a working system breaks. It is a RATCHET, modelled on the
 * `check:scripts` gate this repo already runs (44 errors, baseline 44, no
 * regression): the existing debt is recorded, and the gate fails only when a
 * NEW file starts writing directly.
 *
 * The point is to stop the bleeding and make the number visible, so the debt
 * can be paid down deliberately instead of growing invisibly.
 *
 * ⚠ NOT EVERY DIRECT WRITE IS WRONG. Raw logs, events and derived indexes are
 * legitimately written directly — it is EPISTEMICALLY MEANINGFUL BELIEF STATE
 * that must pass one boundary. This gate cannot tell those apart, so it does
 * not try: it pins the FILE SET and asks a human to justify each addition. A
 * gate that guessed intent would produce confident wrong verdicts, which is
 * worse than a gate that counts honestly.
 *
 * Usage (from apps/statenour):
 *   pnpm exec tsx scripts/check-memory-admission.ts                 # verify
 *   pnpm exec tsx scripts/check-memory-admission.ts --write-baseline
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const BASELINE = join(ROOT, "data", "memory-admission-baseline.json");
const SCAN_DIRS = ["lib", "app", "scripts"];

/** Direct writes that bypass remember(). Reads and deletes are out of scope. */
const DIRECT_WRITE = /prisma\.brainMemory\.(create|createMany|upsert|updateMany)\(/;

interface Baseline {
  recordedAt: string;
  note: string;
  files: string[];
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next" || e === "dist") continue;
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else if (e.endsWith(".ts") || e.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** Files containing at least one direct write. Pure given the filesystem. */
export function findDirectWriters(root = ROOT, dirs = SCAN_DIRS): string[] {
  const hits: string[] = [];
  for (const d of dirs) {
    for (const f of walk(join(root, d))) {
      let src: string;
      try {
        src = readFileSync(f, "utf8");
      } catch {
        continue;
      }
      // ⚠ Strip line comments before matching. A gate that counts a call
      // expression quoted inside a comment reports debt that does not exist,
      // and this repo has shipped that exact defect before.
      const stripped = src.replace(/^\s*\/\/.*$/gm, "");
      if (DIRECT_WRITE.test(stripped)) hits.push(relative(root, f).replace(/\\/g, "/"));
    }
  }
  return hits.sort();
}

/**
 * Compare current writers against the baseline.
 *
 * ADDED is a failure. REMOVED is progress and is reported, not punished — a
 * ratchet that demanded the list stay identical would block the very cleanup it
 * exists to encourage. Pure. Exported for tests.
 */
export function compareToBaseline(
  current: readonly string[],
  baseline: readonly string[],
): { added: string[]; removed: string[]; ok: boolean } {
  const base = new Set(baseline);
  const cur = new Set(current);
  const added = current.filter((f) => !base.has(f));
  const removed = baseline.filter((f) => !cur.has(f));
  return { added, removed, ok: added.length === 0 };
}

function main(): void {
  const current = findDirectWriters();

  if (process.argv.includes("--write-baseline")) {
    const b: Baseline = {
      recordedAt: new Date().toISOString().slice(0, 10),
      note:
        "Files writing prisma.brainMemory directly, bypassing remember(). " +
        "This is recorded DEBT, not approval. Adding a file fails the gate; " +
        "removing one is progress. Raw logs/events/derived indexes may legitimately " +
        "write directly — belief state must not.",
      files: current,
    };
    writeFileSync(BASELINE, JSON.stringify(b, null, 2) + "\n", "utf8");
    console.log(`memory-admission baseline written: ${current.length} files`);
    return;
  }

  if (!existsSync(BASELINE)) {
    console.log(
      `memory-admission · no baseline at ${relative(ROOT, BASELINE)} — ` +
        `run with --write-baseline. Current direct writers: ${current.length} files.`,
    );
    return;
  }

  const b = JSON.parse(readFileSync(BASELINE, "utf8")) as Baseline;
  const { added, removed, ok } = compareToBaseline(current, b.files);

  console.log(
    `memory-admission · ${current.length} direct-writer file(s) (baseline ${b.files.length}, recorded ${b.recordedAt})`,
  );
  if (removed.length > 0) {
    console.log(`  ✓ ${removed.length} file(s) no longer write directly — debt paid down:`);
    for (const f of removed.slice(0, 10)) console.log(`      ${f}`);
  }
  if (!ok) {
    console.error(`  ✖ ${added.length} NEW file(s) write prisma.brainMemory directly:`);
    for (const f of added) console.error(`      ${f}`);
    console.error("");
    console.error(
      "  A durable belief must pass brainMemory.remember() — that is where provenance,",
    );
    console.error(
      "  confidence and supersession are applied. If this write is a raw log, event or",
    );
    console.error(
      "  derived index rather than a belief, add the file to the baseline and say why",
    );
    console.error("  in the commit message.");
    process.exit(1);
  }
  console.log("  ✓ no new direct writers");
}

main();
