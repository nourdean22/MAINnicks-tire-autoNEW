#!/usr/bin/env tsx
/**
 * Freshness-chip audit · v8.2 D5 · Apr 29.
 *
 * Walks `components/**\/*.tsx` looking for files that render
 * <GlassCard> WITHOUT also referencing FreshnessChip OR carrying a
 * `// FRESHNESS_EXEMPT` marker.
 *
 * Exit code 0 when clean; 1 when any drift is found, with a per-file
 * fix hint. Designed to slot into the pre-push hook as step [N/N+1]
 * when the team wants to enforce the rule mechanically — for now
 * it's just a manual check.
 *
 * Usage:
 *   pnpm exec tsx scripts/audit-freshness-chips.ts
 *
 * Flags:
 *   --json   — emit a machine-readable report instead of pretty output
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");
const COMPONENTS_DIR = join(ROOT, "components");

interface Finding {
  file: string;
  reason: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

function audit(): { findings: Finding[]; checked: number; exempt: number } {
  const files = walk(COMPONENTS_DIR);
  const findings: Finding[] = [];
  let checked = 0;
  let exempt = 0;

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    if (!/<GlassCard\b/.test(src)) continue; // Doesn't use GlassCard
    checked++;
    if (/FRESHNESS_EXEMPT/i.test(src)) {
      exempt++;
      continue;
    }
    if (/FreshnessChip\b/.test(src)) continue;
    findings.push({
      file: relative(ROOT, file).replace(/\\/g, "/"),
      reason:
        "GlassCard used but no FreshnessChip and no FRESHNESS_EXEMPT marker. Add <FreshnessChip lastFetchedAt=... source=... /> to the card header, or add a `// FRESHNESS_EXEMPT — <reason>` comment if no data is shown.",
    });
  }

  return { findings, checked, exempt };
}

function main() {
  const json = process.argv.includes("--json");
  const result = audit();

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.findings.length === 0 ? 0 : 1);
  }

  if (result.findings.length === 0) {
    console.log(
      `✅ freshness audit clean — ${result.checked} GlassCard sites checked, ${result.exempt} exempt, 0 drift.`,
    );
    process.exit(0);
  }

  console.log(
    `❌ freshness audit found ${result.findings.length} site(s) without FreshnessChip / FRESHNESS_EXEMPT:\n`,
  );
  for (const f of result.findings) {
    console.log(`  · ${f.file}`);
    console.log(`    ${f.reason}\n`);
  }
  process.exit(1);
}

main();
