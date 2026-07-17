#!/usr/bin/env node
/**
 * Completion Authority — renders docs/operations/REALITY-LEDGER.md from
 * capability-ledger.json so prose can never drift from the machine record.
 * Run after editing the JSON; the markdown is GENERATED, never hand-edited.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "docs", "operations", "capability-ledger.json");
const out = path.join(here, "..", "docs", "operations", "REALITY-LEDGER.md");
const ledger = JSON.parse(readFileSync(src, "utf8"));

const lines = [
  "# Reality Ledger",
  "",
  "**GENERATED from `capability-ledger.json` by `scripts/render-reality-ledger.mjs` — do not edit by hand.**",
  "",
  "State advances only with evidence (`scripts/check-capability-ledger.mjs` enforces the gates in CI).",
  "`Merged` is deliberately not a state: merging code and promoting a capability are independent events.",
  "",
  "| Capability | State | Blockers | Evidence highlights | Deferred scope |",
  "|---|---|---|---|---|",
];
for (const c of ledger.capabilities) {
  const blockers = (c.blockers ?? []).map((b) => `**${b.severity}** ${b.description}`).join("<br>") || "—";
  const ev = Object.entries(c.evidence ?? {})
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("; ") : v}`)
    .join("<br>") || "—";
  const deferred = (c.deferredScope ?? []).join(", ") || "—";
  lines.push(`| ${c.name} | \`${c.state}\` | ${blockers} | ${ev} | ${deferred} |`);
}
lines.push("");
writeFileSync(out, lines.join("\n"));
console.log(`✓ rendered ${path.relative(process.cwd(), out)} (${ledger.capabilities.length} capabilities)`);
