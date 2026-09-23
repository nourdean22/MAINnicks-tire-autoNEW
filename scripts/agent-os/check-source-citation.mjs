#!/usr/bin/env node
/**
 * Charter rule 7, the enforceable slice: if a PR changes a DEPENDENCY, its body
 * must cite a current source (a URL and a date).
 *
 * WHY ONLY THIS SLICE. Rule 7 says verify current practice before changing a
 * library, API, SDK, platform behaviour, pricing, config pattern or approach.
 * Exactly one of those is mechanically detectable from a diff: a dependency
 * manifest edit. "Switched approach on reasoning alone" and "assumed a platform
 * still behaves this way" leave no syntactic trace, and a gate that pretended to
 * catch them would be the thing this repo keeps writing down — a control that
 * reports green over an unobserved subject. This gate covers the detectable
 * subset and says so; the rest is on review, and is audited by the coordination
 * session rather than by a script.
 *
 * FALSE POSITIVES DESIGNED AGAINST (each one observed while writing this):
 *   · A `"scripts"` entry added to package.json is not a dependency change.
 *     PR #1974 added `db:seed:sources` and a naive package.json check flagged it.
 *   · A data file that merely LOOKS like a manifest. PR #1972 was a docs-only
 *     reel pack whose brief.json carries `"time": "0:00-0:04"` lines; a naive
 *     `"name": "version"` regex over the raw diff called it 9 dependency edits.
 *     So this reads the dependency BLOCKS, not any JSON-shaped line.
 *   · A dependency REMOVAL needs no citation about current practice — you are
 *     not adopting anything. Removals alone do not trigger the gate.
 *
 * Usage (CI):  node scripts/agent-os/check-source-citation.mjs --diff <file> --body <file>
 * Exit 0 = compliant or not triggered · exit 1 = triggered and uncited.
 */
import { isMainModule } from "./cli-common.mjs";

/** Blocks whose edits mean "we are adopting or moving a dependency". */
const DEP_BLOCKS = new Set([
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]);

/**
 * Does this unified diff change a dependency?
 *
 * Walks the diff statefully: it tracks the file being patched and, inside a
 * package.json, which JSON block the hunk is in. Only ADDED or MODIFIED entries
 * inside a dependency block count. Returns the offending entries so the failure
 * message can name them.
 */
export function dependencyChanges(diffText) {
  const hits = [];
  let file = null;
  let block = null;
  let inPackageJson = false;

  for (const raw of String(diffText).split("\n")) {
    if (raw.startsWith("+++ ")) {
      file = raw.slice(4).replace(/^b\//, "").trim();
      inPackageJson = /(^|\/)package\.json$/.test(file);
      block = null;
      continue;
    }
    if (raw.startsWith("--- ") || raw.startsWith("diff --git")) continue;

    // pnpm-workspace catalog moves a version for every consumer at once.
    if (file === "pnpm-workspace.yaml" && /^\+\s{2,}\S+:\s*\S+/.test(raw)) {
      hits.push({ file, entry: raw.slice(1).trim() });
      continue;
    }

    if (!inPackageJson) continue;

    // Track the current JSON block from context AND changed lines alike — a
    // hunk can open inside a block whose header is only in the context lines.
    const blockOpen = /^[+\- ]\s*"([A-Za-z]+)"\s*:\s*\{/.exec(raw);
    if (blockOpen) {
      block = blockOpen[1];
      continue;
    }
    if (/^[+\- ]\s*\}/.test(raw)) {
      block = null;
      continue;
    }

    // An ADDED entry inside a dependency block is the trigger. A removal is not:
    // dropping a package adopts nothing.
    if (raw.startsWith("+") && block && DEP_BLOCKS.has(block)) {
      const entry = /^\+\s*"([^"]+)"\s*:\s*"([^"]*)"/.exec(raw);
      if (entry) hits.push({ file, entry: `${entry[1]}@${entry[2]}` });
    }
  }
  return hits;
}

/** A citation is a URL plus a date — either alone is not a source. */
export function citation(bodyText) {
  const body = String(bodyText ?? "");
  const url = /https?:\/\/[^\s)<>\]]+/.exec(body);
  const date =
    /\b\d{4}-\d{2}-\d{2}\b/.exec(body) ??
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i.exec(body);
  return { url: url?.[0] ?? null, date: date?.[0] ?? null, ok: Boolean(url && date) };
}

export function assess(diffText, bodyText) {
  const changes = dependencyChanges(diffText);
  if (changes.length === 0) return { triggered: false, ok: true, changes, cite: citation(bodyText) };
  const cite = citation(bodyText);
  return { triggered: true, ok: cite.ok, changes, cite };
}

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}

async function main() {
  const { readFileSync } = await import("node:fs");
  const diffPath = argOf("--diff");
  const bodyPath = argOf("--body");
  if (!diffPath || !bodyPath) {
    // A gate that cannot see its subject must never report success.
    console.error("check-source-citation: --diff and --body are required. Refusing to pass blind.");
    process.exit(2);
  }
  const verdict = assess(readFileSync(diffPath, "utf8"), readFileSync(bodyPath, "utf8"));

  if (!verdict.triggered) {
    console.log("source-citation: no dependency change in this PR — rule 7's mechanical slice does not apply.");
    return;
  }
  if (verdict.ok) {
    console.log(
      `source-citation: OK — ${verdict.changes.length} dependency change(s) cited (${verdict.cite.url}, ${verdict.cite.date}).`,
    );
    return;
  }

  console.error("source-citation: FAILED — charter rule 7.");
  console.error("");
  console.error("  This PR changes a dependency:");
  for (const c of verdict.changes.slice(0, 10)) console.error(`    · ${c.file}: ${c.entry}`);
  console.error("");
  console.error("  Rule 7: verify current practice BEFORE you change it, and cite it.");
  console.error("  Training data is a fact about the past; anything versioned or platform-");
  console.error("  controlled has moved. Put a URL and a date in the PR body.");
  console.error("");
  console.error(`  found: url=${verdict.cite.url ?? "(none)"} date=${verdict.cite.date ?? "(none)"}`);
  console.error("");
  console.error("  This gate covers ONLY dependency edits. Changing a platform assumption or");
  console.error("  switching an approach leaves no syntactic trace and is on review.");
  process.exit(1);
}

if (isMainModule(import.meta.url)) {
  main();
}
