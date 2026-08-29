#!/usr/bin/env node
/**
 * ORPHAN CHECK — exported symbols that nothing imports.
 *
 * WHY THIS EXISTS. In one day this repo produced eight confirmed instances of a
 * correct component wired to nothing: `ingestFinishedMp4` (twelve tests, zero
 * importers), `DUA_FRANCHISE_KITS`, a `DuaConcept` nobody constructs, 104 of 136
 * unreachable reel packs, a disclosure field no caller sent, `checkLayerBoundary`
 * (vacuous by construction), and relevance computed then discarded. Each was
 * found by hand and fixed by hand. That does not scale, and the ninth ships
 * tomorrow. See docs/agent-audit/PATTERN-PRODUCER-WITHOUT-CONSUMER.md.
 *
 * The failure is invisible to every existing control: the producer is correct,
 * its tests pass because they exercise the producer, and review passes because
 * the code is good. Nobody looks for the reader.
 *
 * WHY IT BASELINES INSTEAD OF FAILING ON EVERYTHING. A check that fires two
 * hundred times on day one is switched off by day two — this repo has that
 * history. The existing orphans are recorded in an allowlist so the build is
 * green today, and ANY NEW ENTRY IS A FAILURE.
 *
 * WHY EVERY ENTRY NEEDS A REASON. Unwired-by-accident and unwired-by-design are
 * different things and only one is a defect. `ingestFinishedMp4` is deliberately
 * dark pending an API-key route — that is a legitimate entry with a real reason.
 * An accidental orphan has no reason to write, which is the entire mechanism.
 *
 * DELIBERATELY CONSERVATIVE. Consumption is matched by NAME, not by resolved
 * module path, so a symbol sharing a name with something imported elsewhere
 * reads as consumed. That under-reports. For a gate that must never fire falsely
 * this is the correct direction to be wrong in: a false positive here gets the
 * check disabled, which costs more than a missed orphan.
 *
 *   node scripts/orphan-check.mjs            # gate: fails on NEW orphans
 *   node scripts/orphan-check.mjs --list     # every orphan, allowlist ignored
 *   node scripts/orphan-check.mjs --baseline # rewrite the allowlist (deliberate)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const APP = path.resolve(import.meta.dirname, "..");
const ALLOWLIST = path.join(APP, "config", "orphan-allowlist.json");

/** Source we own. Tests and fixtures are excluded as CONSUMERS on purpose:
 *  a symbol imported only by its own test is the exact defect being hunted. */
const isTest = (f) => /(\.test\.|\.spec\.|__tests__\/|__fixtures__\/|\/fixtures\/)/.test(f);
const isScanned = (f) =>
  /^(client\/src|server|shared)\/.*\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts") && !isTest(f);

function sourceFiles() {
  return execSync("git ls-files", { cwd: APP, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter(isScanned);
}

/**
 * VALUES ONLY, and that narrowing is deliberate and measured.
 *
 * Scanning types too found 1,910 orphans, of which 848 (44%) were `type` and
 * `interface` — overwhelmingly local prop types exported out of habit. Those are
 * a style nit, not a wired/unwired defect, and "I added a local type" is exactly
 * the benign new failure that would get this check switched off in a week.
 *
 * All EIGHT confirmed instances are values: DUA_FRANCHISE_KITS, ingestFinishedMp4,
 * checkLayerBoundary, the unsent disclosure field, and the rest. Run with
 * `--types` to include them.
 */
const VALUE_PATTERNS = [
  /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
  /^export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^export\s+enum\s+([A-Za-z_$][\w$]*)/,
  /^export\s+declare\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/,
];
const TYPE_PATTERNS = [
  /^export\s+interface\s+([A-Za-z_$][\w$]*)/,
  /^export\s+type\s+([A-Za-z_$][\w$]*)/,
];
const EXPORT_PATTERNS = process.argv.includes("--types")
  ? [...VALUE_PATTERNS, ...TYPE_PATTERNS]
  : VALUE_PATTERNS;

function exportsOf(text) {
  const found = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("export default") || line.startsWith("export *")) continue;
    for (const p of EXPORT_PATTERNS) {
      const m = line.match(p);
      if (m) {
        found.push(m[1]);
        break;
      }
    }
  }
  return found;
}

/** Names pulled in by any import-shaped construct. `A as B` yields A. */
const names = (blob) =>
  blob
    .split(",")
    .map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim())
    .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));

function importsOf(text) {
  const out = new Set();
  const add = (blob) => names(blob).forEach((n) => out.add(n));
  // import { a, b } from "..."   /   export { a } from "..."
  for (const m of text.matchAll(/(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from/g)) add(m[1]);
  // import X from / import X, { y } from / import * as X from
  for (const m of text.matchAll(/import\s+(?:type\s+)?(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s*(?:,\s*\{([^}]*)\})?\s*from/g)) {
    out.add(m[1]);
    if (m[2]) add(m[2]);
  }
  // const { a } = await import("...")  — heavily used in this codebase's routers
  for (const m of text.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s+)?(?:import|require)\(/g)) add(m[1]);
  return out;
}

function scan() {
  const files = sourceFiles();
  const all = execSync("git ls-files", { cwd: APP, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split(/\r?\n/)
    .filter((f) => /\.(ts|tsx|mjs|mts)$/.test(f));

  const declared = []; // { symbol, file }
  const importedBy = new Map(); // symbol -> Set(file)

  for (const f of all) {
    let text;
    try {
      text = readFileSync(path.join(APP, f), "utf8");
    } catch {
      continue;
    }
    if (isScanned(f)) for (const s of exportsOf(text)) declared.push({ symbol: s, file: f });
    if (isTest(f)) continue; // a test is not a consumer
    for (const n of importsOf(text)) {
      if (!importedBy.has(n)) importedBy.set(n, new Set());
      importedBy.get(n).add(f);
    }
  }

  return declared
    .filter(({ symbol, file }) => {
      const users = importedBy.get(symbol);
      if (!users) return true;
      for (const u of users) if (u !== file) return false; // a real consumer exists
      return true;
    })
    .sort((a, b) => a.file.localeCompare(b.file) || a.symbol.localeCompare(b.symbol));
}

// ─── main ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const orphans = scan();
const key = (o) => `${o.file}:${o.symbol}`;

if (args.includes("--list")) {
  console.log(`orphan-check --list — ${orphans.length} exported symbol(s) with no non-test importer\n`);
  for (const o of orphans) console.log(`  ${o.file}  ${o.symbol}`);
  process.exit(0);
}

if (args.includes("--baseline")) {
  const prev = existsSync(ALLOWLIST) ? JSON.parse(readFileSync(ALLOWLIST, "utf8")) : { allowed: [] };
  const reasons = new Map(prev.allowed.map((e) => [`${e.file}:${e.symbol}`, e.reason]));
  writeFileSync(
    ALLOWLIST,
    JSON.stringify(
      {
        $comment:
          "Exported symbols with no non-test importer, accepted at baseline. ANY NEW ENTRY IS A CI FAILURE — see scripts/orphan-check.mjs. Every entry needs a real reason; an accidental orphan has none to write.",
        allowed: orphans.map((o) => ({
          file: o.file,
          symbol: o.symbol,
          // `||` not `??` on purpose: an empty-string reason is MISSING, and `??`
          // would launder a blank through a re-baseline, defeating the one
          // mechanism that separates a deliberate orphan from an accidental one.
          reason: (reasons.get(key(o)) || "").trim() || "baseline 2026-08-29 — pre-existing, not individually reviewed",
        })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`baseline written: ${orphans.length} entries`);
  process.exit(0);
}

if (!existsSync(ALLOWLIST)) {
  console.error(`orphan-check: no allowlist at ${ALLOWLIST} — run with --baseline first`);
  process.exit(1);
}

const list = JSON.parse(readFileSync(ALLOWLIST, "utf8"));
const allowed = new Map(list.allowed.map((e) => [`${e.file}:${e.symbol}`, e]));

const missingReason = list.allowed.filter((e) => !e.reason || !e.reason.trim());
const fresh = orphans.filter((o) => !allowed.has(key(o)));
const stale = list.allowed.filter((e) => !orphans.some((o) => key(o) === `${e.file}:${e.symbol}`));

console.log(`orphan-check — ${orphans.length} orphan(s), ${allowed.size} allowlisted, ${fresh.length} NEW`);

if (stale.length) {
  console.log(`\n  ${stale.length} allowlist entr(ies) now consumed — prune with --baseline:`);
  for (const e of stale.slice(0, 10)) console.log(`    ${e.file}  ${e.symbol}`);
}

if (missingReason.length) {
  console.error(`\n✗ ${missingReason.length} allowlist entr(ies) carry no reason:`);
  for (const e of missingReason) console.error(`    ${e.file}  ${e.symbol}`);
}

if (fresh.length) {
  console.error(`\n✗ NEW ORPHAN(S) — exported but nothing outside a test imports them:\n`);
  for (const o of fresh) console.error(`    ${o.file}  ${o.symbol}`);
  console.error(
    `\n  Build the consuming half, or add an entry to config/orphan-allowlist.json WITH A REASON.\n` +
      `  If a consumer would still never fire, the symbol is vacuous rather than unwired — say so in the reason.\n` +
      `  docs/agent-audit/PATTERN-PRODUCER-WITHOUT-CONSUMER.md\n`,
  );
}

if (fresh.length || missingReason.length) process.exit(1);
console.log("\n✓ no new orphans");
