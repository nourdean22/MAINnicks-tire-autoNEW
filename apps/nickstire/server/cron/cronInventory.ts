/**
 * CRON-INVENTORY.md is generated, not hand-maintained (2026-09-01 audit).
 * This module is the pure builder/parser so a test can hold the doc to the
 * scheduler without touching the filesystem.
 */

export interface CadenceEntry {
  intervalMin: number;
  businessHoursOnly: boolean;
  oncePerShopDay: boolean;
  tier: string;
  scheduledAutomatically: boolean;
}

export interface InventoryInput {
  cadences: Map<string, CadenceEntry>;
  httpJobs: Array<{ name: string; enabled: boolean }>;
  purposes: Map<string, string>;
  generatedOn: string;
}

export const CRON_INVENTORY_BEGIN = "<!-- generated:begin — do not edit by hand; run pnpm exec tsx scripts/gen-cron-inventory.mts -->";
export const CRON_INVENTORY_END = "<!-- generated:end -->";

const TIER_ORDER = ["heartbeat", "pulse", "hourly", "daily", "briefings"];

function fmtInterval(min: number): string {
  if (min % 1440 === 0) return `${min / 1440}d`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${min}m`;
}

/** Job rows in the existing doc: | `name` | ... purpose ... | — keep the purpose text. */
export function parseExistingPurposes(markdown: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^\|\s*`([a-z0-9._-]+)`\s*\|(.+)\|\s*$/i.exec(line);
    if (!m) continue;
    const cells = m[2].split("|").map((c) => c.trim());
    const purpose = cells[cells.length - 1];
    if (purpose && purpose !== "—" && !/^(every|[0-9]+[mhd]$)/i.test(purpose)) out.set(m[1], purpose);
  }
  return out;
}

export function buildCronInventoryMarkdown(input: InventoryInput): string {
  const byTier = new Map<string, Array<[string, CadenceEntry]>>();
  for (const [name, c] of input.cadences) {
    if (!byTier.has(c.tier)) byTier.set(c.tier, []);
    byTier.get(c.tier)!.push([name, c]);
  }
  const tiers = [...byTier.keys()].sort((a, b) => {
    const ia = TIER_ORDER.indexOf(a); const ib = TIER_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });

  const scheduled = [...input.cadences.values()].filter((c) => c.scheduledAutomatically).length;
  const staged = input.cadences.size - scheduled;
  const httpOnly = input.httpJobs.filter((j) => !input.cadences.has(j.name));

  const lines: string[] = [];
  lines.push("# Cron Inventory — What Runs, When, Why");
  lines.push("");
  lines.push("Every background job in `server/cron/scheduler.ts` (tiered scheduler) and the");
  lines.push("HTTP-triggerable registry in `server/cron/index.ts`. **This file is generated** from");
  lines.push("those two sources — `server/cron/cronInventoryParity.test.ts` fails when they drift.");
  lines.push("");
  lines.push(`**Last regenerated: ${input.generatedOn} by \`scripts/gen-cron-inventory.mts\`.**`);
  lines.push("");
  lines.push("> The code is the source of truth. To add or change a job, edit the scheduler and");
  lines.push("> re-run the generator in the same commit; write the job's purpose in the last column.");
  lines.push("");
  lines.push(CRON_INVENTORY_BEGIN);
  lines.push("");
  lines.push("## Tier overview");
  lines.push("");
  lines.push("| Tier | Interval | Jobs (scheduled / staged) |");
  lines.push("|---|---|---|");
  for (const t of tiers) {
    const jobs = byTier.get(t)!;
    const sch = jobs.filter(([, c]) => c.scheduledAutomatically).length;
    lines.push(`| ${t} | every ${fmtInterval(jobs[0][1].intervalMin)} | ${sch} / ${jobs.length - sch} |`);
  }
  lines.push("");
  lines.push(`**Total: ${input.cadences.size} tiered jobs (${scheduled} scheduled automatically, ${staged} staged off the scheduler) + ${httpOnly.length} HTTP-only registry jobs.**`);
  lines.push("");
  for (const t of tiers) {
    const jobs = byTier.get(t)!.sort((a, b) => a[0].localeCompare(b[0]));
    lines.push(`## ${t} (every ${fmtInterval(jobs[0][1].intervalMin)})`);
    lines.push("");
    lines.push("| Job | Business hours only | Once per shop day | Scheduled | Purpose |");
    lines.push("|---|---|---|---|---|");
    for (const [name, c] of jobs) {
      lines.push(`| \`${name}\` | ${c.businessHoursOnly ? "yes" : "no"} | ${c.oncePerShopDay ? "yes" : "no"} | ${c.scheduledAutomatically ? "yes" : "**STAGED — HTTP trigger only**"} | ${input.purposes.get(name) ?? "—"} |`);
    }
    lines.push("");
  }
  lines.push("## HTTP-only registry jobs (`server/cron/index.ts`)");
  lines.push("");
  lines.push("Runnable via `POST /api/admin/run-staged-cron` / `runJobByName`; not on a tier.");
  lines.push("");
  lines.push("| Job | Enabled | Purpose |");
  lines.push("|---|---|---|");
  for (const j of httpOnly.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`| \`${j.name}\` | ${j.enabled ? "yes" : "no"} | ${input.purposes.get(j.name) ?? "—"} |`);
  }
  lines.push("");
  lines.push(CRON_INVENTORY_END);
  lines.push("");
  lines.push("## How skip logic works");
  lines.push("");
  lines.push("- `businessHoursOnly`: the tier runner skips the job outside shop hours (America/New_York).");
  lines.push("- `oncePerShopDay`: the job runs at most once per shop day; a completed `cron_log` row for today suppresses it.");
  lines.push("- Staged jobs keep their tier metadata for cadence display but are never fired by the scheduler.");
  lines.push("- A handler that THROWS is recorded `failed` in `cron_log` and counts toward the observer's failure streak; a handler that returns is `completed` — so a job must throw on failure, never return `Failed: …` in details (2026-09-01 audit, F-9).");
  lines.push("");
  return lines.join("\n");
}

/** Names listed in the generated block of a doc — for the parity test. */
export function parseInventoryJobNames(markdown: string): Set<string> {
  const start = markdown.indexOf(CRON_INVENTORY_BEGIN);
  const end = markdown.indexOf(CRON_INVENTORY_END);
  const block = start >= 0 && end > start ? markdown.slice(start, end) : "";
  const names = new Set<string>();
  for (const line of block.split(/\r?\n/)) {
    const m = /^\|\s*`([a-z0-9._-]+)`\s*\|/i.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}
