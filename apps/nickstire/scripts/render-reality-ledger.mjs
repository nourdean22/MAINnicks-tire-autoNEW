#!/usr/bin/env node
/**
 * Completion Authority — renders docs/operations/REALITY-LEDGER.md from
 * capability-ledger.json so prose can never drift from the machine record.
 * Run after editing the JSON; the markdown is GENERATED, never hand-edited.
 *
 * DETERMINISM RULE: this file is verified in CI with `git diff --exit-code`,
 * so the render MUST NOT depend on the clock. The "Verify by" column prints
 * the stored verificationExpiresAt date and nothing derived from it — a
 * FRESH/STALE verdict here would rewrite the file on a tick and turn CI red
 * on the passage of time rather than on a fact. The verdict is the
 * validator's stdout (check-capability-ledger.mjs), which is allowed to know
 * what day it is. A document asserting "fresh" is itself a claim with an
 * expiry date; this one declines to make it.
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
  "Three axes: codeState (a merge changes ONLY this) x operationalState (advances only with evidence) x exposure (the promotion decision). Operational state advances only with evidence (`scripts/check-capability-ledger.mjs` enforces the gates in CI).",
  "`Merged` is deliberately not a state: merging code and promoting a capability are independent events.",
  "`Verify by` is the date this capability's evidence stops counting as current knowledge — required at `deployed`+, because those claims rest on things that can die with no commit (a credential, a session, prod data, a provider quota). Past that date the claim is not false, it is UNKNOWN: re-prove it and reset the date, or lower the claim with `scripts/regress-capability.mjs`. Whether a given capability is currently past its date is reported by `scripts/check-capability-ledger.mjs`, never by this file — this table must not change on a clock tick.",
  "",
  "| Capability | Code | Operational | Exposure | Verify by | Blockers | Evidence highlights | Deferred scope |",
  "|---|---|---|---|---|---|---|---|",
];
for (const c of ledger.capabilities) {
  const blockers = (c.blockers ?? []).map((b) => `**${b.severity}** ${b.description}`).join("<br>") || "—";
  const ev = Object.entries(c.evidence ?? {})
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("; ") : v}`)
    .join("<br>") || "—";
  const deferred = (c.deferredScope ?? []).join(", ") || "—";
  const verifyBy = c.verificationExpiresAt ? `\`${c.verificationExpiresAt}\`` : "—";
  lines.push(`| ${c.name} | \`${c.codeState}\` | \`${c.operationalState}\` | \`${c.exposure}\` | ${verifyBy} | ${blockers} | ${ev} | ${deferred} |`);
}
lines.push("");
writeFileSync(out, lines.join("\n"));
console.log(`✓ rendered ${path.relative(process.cwd(), out)} (${ledger.capabilities.length} capabilities)`);
