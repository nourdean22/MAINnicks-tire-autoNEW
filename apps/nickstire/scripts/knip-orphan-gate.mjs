#!/usr/bin/env node
/**
 * KNIP ORPHAN GATE — baseline what knip finds, fail on anything NEW.
 *
 * Knip does the DETECTION (module-graph-accurate, maintained standard — ts-prune
 * is archived and points here). This wrapper does the two things knip does not
 * ship: a REASON-CARRYING baseline so the gate goes green on day one and only
 * new findings fail, and the SCRIPT-WITH-NO-INVOKER check, which no static
 * JS/TS analyser can see.
 *
 * WHAT COUNTS AS CONSUMED HERE. Test files are excluded from the nickstire
 * workspace in knip.json (project globs + vitest plugin off), so an export
 * imported only by its own test is an orphan. That is the exact shape that hid
 * `ingestFinishedMp4` — twelve tests, zero importers — for weeks.
 *
 * THE DISTINCTION THE REASONS FIELD CARRIES. Unwired-by-accident and
 * unwired-by-design are different and only one is a defect. An accidental
 * orphan has no reason to write. `checkLayerBoundary` is vacuous by
 * construction (a consumer would still never fire); that is a legitimate entry
 * with a real reason. See docs/agent-audit/PATTERN-PRODUCER-WITHOUT-CONSUMER.md.
 *
 * ISSUE TYPES GATED. `files` (an entire unreachable module) and `exports`
 * (values: functions/consts/classes/enums). `types` are NOT gated: 317 of the
 * findings are local prop types exported by habit, a style nit, and "I added a
 * local type" is exactly the benign failure that gets a check switched off.
 *
 * PLUS: package.json scripts with zero invokers. Knip is JS/TS-scoped and
 * cannot see that `graphify:sync` is referenced nowhere — its whole import
 * chain (manifest + ingest scripts -> the graphify adapter) is alive only
 * because a HUMAN might type the command. Cheap grep check, same baseline.
 *
 *   node scripts/knip-orphan-gate.mjs             # gate: fail on NEW findings
 *   node scripts/knip-orphan-gate.mjs --baseline  # regenerate, preserving reasons
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const BASELINE = path.join(import.meta.dirname, "..", "config", "knip-orphan-baseline.json");
const KNIP_VERSION = "6.32.3";

const key = (file, symbol) => `${file}|${symbol ?? ""}`;

function runKnip() {
  // DATABASE_URL: knip loads drizzle.config.ts as a config file; a dummy value
  // satisfies its presence check. Nothing connects — this is a config LOAD.
  //
  // knip exits 1 when it FINDS issues — for this gate that is success, not
  // failure, so the command's exit status is deliberately ignored and only the
  // JSON reporter output is trusted.
  const cmd = `pnpm dlx knip@${KNIP_VERSION} --workspace apps/nickstire --include files,exports --reporter json`;
  const opts = { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, DATABASE_URL: "mysql://knip-no-connection" } };
  let out;
  try {
    out = execSync(cmd, opts);
  } catch (err) {
    if (!err.stdout) throw err;
    out = err.stdout; // issues were found (exit 1); the JSON is still valid
  }
  const start = out.indexOf("{");
  if (start === -1) throw new Error("knip produced no JSON on stdout");
  return JSON.parse(out.slice(start));
}

function knipFindings() {
  const found = [];
  for (const fileGroup of runKnip().issues) {
    for (const f of fileGroup.files ?? []) found.push({ file: f.name, symbol: null });
    for (const e of fileGroup.exports ?? []) found.push({ file: fileGroup.file, symbol: e.name });
  }
  return found;
}

/**
 * package.json scripts that nothing invokes. A script is INVOKED if its name
 * appears outside the package.json that declares it — in a workflow, another
 * script, code, or a doc. grep-based by design: the failure mode (a hand-run
 * command that exists only in someone's memory) is invisible to any analyser,
 * so the honest cheap version asks only "is it referenced ANYWHERE?".
 */
function orphanScripts() {
  const out = [];
  for (const pkg of ["apps/nickstire/package.json", "apps/statenour/package.json"]) {
    const scripts = Object.keys(JSON.parse(readFileSync(path.join(REPO, pkg), "utf8")).scripts ?? {});
    for (const name of scripts) {
      // `git grep -l` across the repo; a reference anywhere except the
      // declaring package.json counts as an invoker.
      const hits = execSync(`git grep -l -F "${name}" -- . ":(exclude)pnpm-lock.yaml"`, {
        cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
      }).split(/\r?\n/).filter((f) => f && f !== pkg);
      if (hits.length === 0) out.push({ file: pkg, symbol: name });
    }
  }
  return out;
}

// ─── main ──────────────────────────────────────────────────────────
const baselineMode = process.argv.includes("--baseline");
const findings = [...knipFindings(), ...orphanScripts()];

if (baselineMode) {
  const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { entries: [] };
  const reasons = new Map(prev.entries.map((e) => [key(e.file, e.symbol), e.reason]));
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        $comment:
          "knip + script-invoker findings accepted at baseline. ANY NEW ENTRY IS A CI FAILURE — see scripts/knip-orphan-gate.mjs. Every entry needs a real reason; an accidental orphan has none to write.",
        entries: findings.map((f) => ({
          file: f.file,
          symbol: f.symbol,
          // `||` not `??`: an empty-string reason is MISSING. A blank must never
          // survive a re-baseline — that would launder an accidental orphan in.
          reason: (reasons.get(key(f.file, f.symbol)) || "").trim() || "baseline 2026-08-29 — pre-existing, not individually reviewed",
        })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`baseline written: ${findings.length} entries (knip files+exports, unreferenced scripts)`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error("knip-orphan-gate: no baseline — run with --baseline first");
  process.exit(1);
}

const list = JSON.parse(readFileSync(BASELINE, "utf8"));
const allowed = new Map(list.entries.map((e) => [key(e.file, e.symbol), e]));

const missingReason = list.entries.filter((e) => !e.reason || !e.reason.trim());
const fresh = findings.filter((f) => !allowed.has(key(f.file, f.symbol)));

console.log(`knip-orphan-gate — ${findings.length} finding(s), ${list.entries.length} baselined, ${fresh.length} NEW`);

if (missingReason.length) {
  console.error(`\n✗ ${missingReason.length} baseline entr(ies) carry no reason:`);
  for (const e of missingReason) console.error(`    ${e.file}  ${e.symbol ?? "(whole file)"}`);
}

if (fresh.length) {
  console.error(`\n✗ NEW ORPHAN(S):\n`);
  for (const f of fresh) console.error(`    ${f.file}  ${f.symbol ?? "(whole file — nothing imports it)"}`);
  console.error(
    `\n  Wire it, delete it, or add a baseline entry WITH A REASON.\n` +
      `  If a consumer would still never fire, it is vacuous rather than unwired — say so in the reason.\n` +
      `  docs/agent-audit/PATTERN-PRODUCER-WITHOUT-CONSUMER.md\n`,
  );
}

if (fresh.length || missingReason.length) process.exit(1);
console.log("✓ no new orphans");