#!/usr/bin/env node
/**
 * Refresh config/fail-open-slice-baseline.json.
 *
 * Run this after CONVERTING sites to sliceBlock() — i.e. after a count goes
 * DOWN. It shares its scanner with the gate (scripts/lib/failOpenSliceScan.mjs)
 * so the two cannot drift.
 *
 *   node scripts/update-fail-open-slice-baseline.mjs
 *
 * It refuses to raise any count. The baseline is a ratchet: lowering it records
 * debt paid down, raising it would launder a new fail-open slice into the
 * allowance and defeat the gate. A genuinely intended raw slice opts out inline
 * with a `fail-open-slice-ok` comment instead.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { scanFailOpenSlices } from "./lib/failOpenSliceScan.mjs";

const APP = resolve(import.meta.dirname, "..");
const PATH = resolve(APP, "config/fail-open-slice-baseline.json");

const current = scanFailOpenSlices(APP);

let previous = {};
try {
  previous = JSON.parse(readFileSync(PATH, "utf8"));
} catch {
  console.log("no existing baseline — writing a fresh one");
}

const raised = Object.entries(current).filter(([f, n]) => n > (previous[f] ?? 0));
if (raised.length > 0 && Object.keys(previous).length > 0) {
  console.error("REFUSED — this would RAISE the baseline, laundering new fail-open slices:");
  for (const [f, n] of raised) console.error(`  ${f}: ${n} (was ${previous[f] ?? 0})`);
  console.error(
    "\nUse sliceBlock() from server/testUtils/sourceBlock.ts, or mark a deliberate\n" +
      "raw slice with a 'fail-open-slice-ok' comment on or above the line.",
  );
  process.exit(1);
}

writeFileSync(PATH, JSON.stringify(current, null, 2) + "\n");

const before = Object.values(previous).reduce((a, b) => a + b, 0);
const after = Object.values(current).reduce((a, b) => a + b, 0);
console.log(`files: ${Object.keys(current).length}  sites: ${after}` + (before ? ` (was ${before})` : ""));
