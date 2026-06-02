/**
 * lib/ai/prompt/sections/automation-and-health.ts · Wave 84 · 2026-05-17
 *
 * Pure formatter for v1's smart-devices summary + automation rules +
 * integration syncs + AI-tools health line (system-prompt.ts:
 * 1704-1872 pre-split).
 *
 * Caller pre-fetches all the data; this is pure string assembly.
 */

import { toDateString } from "@/lib/utils/datetime";

export function renderSmartDevicesSummary(input: {
  devices: { platform: string }[];
}): string[] {
  const { devices } = input;
  if (devices.length === 0) return [];

  // Apr 28 · Trimmed from full device list (~1.5kc when 15 devices)
  // to a single-line count. Tool call recovers the full list when
  // the conversation actually needs it.
  const onlineCount = devices.length;
  const platforms = [...new Set(devices.map((d) => d.platform))].slice(0, 5).join("/");
  const p: string[] = [];
  p.push(`## Smart Devices: ${onlineCount} online · platforms: ${platforms}`);
  p.push(``);
  return p;
}

export function renderAutomationRules(input: {
  // `trigger` is a Prisma JsonValue in the live schema; stringify
  // here lets the formatter stay schema-agnostic.
  automationRulesData: { name: string; trigger: unknown; lastFired: Date | null }[];
}): string[] {
  const { automationRulesData } = input;
  if (automationRulesData.length === 0) return [];

  const p: string[] = [];
  p.push(`## Active Automation Rules (${automationRulesData.length})`);
  for (const r of automationRulesData) {
    const fired = r.lastFired ? `last fired ${toDateString(new Date(r.lastFired))}` : "never fired";
    p.push(`- ${r.name} (${String(r.trigger)}) — ${fired}`);
  }
  p.push(``);
  return p;
}

export function renderIntegrationSyncs(input: {
  recentSyncsData: {
    createdAt: Date;
    integrationId: string;
    status: string;
    recordsIn: number;
    recordsOut: number;
  }[];
}): string[] {
  const { recentSyncsData } = input;
  if (recentSyncsData.length === 0) return [];

  const p: string[] = [];
  p.push(`## Recent Integration Syncs`);
  for (const s of recentSyncsData) {
    p.push(`${new Date(s.createdAt).toISOString().slice(0, 16)}: ${s.integrationId} — ${s.status} (${s.recordsIn} in, ${s.recordsOut} out)`);
  }
  p.push(``);
  return p;
}

/**
 * Renders the one-line AI tools health summary.
 *
 * Apr 28 · Trimmed — listing every active tool name was 1-2kc per
 * prompt for ~zero benefit (the LLM doesn't pick tools by name from
 * this section — it reads the actual tool schema delivered with
 * streamText). Just show health stats.
 */
export function renderAiToolsHealth(input: {
  arsenalStats: { active: number; total: number };
  pendingCount: number;
}): string[] {
  const { arsenalStats, pendingCount } = input;
  const p: string[] = [];
  p.push(
    `## AI Tools: ${arsenalStats.active}/${arsenalStats.total} active${pendingCount > 0 ? ` · ${pendingCount} pending setup` : ""}`,
  );
  p.push(``);
  return p;
}

/**
 * Renders the "RECENT BRAIN DUMPS" block. Caller pre-fetches the
 * dumps; this file emits the lines.
 */
export function renderRecentBrainDumps(input: {
  recentBrainDumps: {
    date: string;
    summary: string | null;
    patterns: unknown;
    entryType: string | null;
    linkStatus: string | null;
    goal: { title: string } | null;
    mission: { title: string } | null;
  }[];
}): string[] {
  const { recentBrainDumps } = input;
  if (recentBrainDumps.length === 0) return [];

  // Brain dumps — drop raw thoughts (200ch each, low signal). Just
  // summary + patterns; raw is searchable via brain memory tool if
  // Nick actually needs the unprocessed text.
  const p: string[] = [];
  p.push(`# RECENT BRAIN DUMPS`);
  for (const dump of recentBrainDumps) {
    const type = dump.entryType ?? "raw";
    // Surface the goal/mission link only when auto-detected or
    // operator-confirmed; never proposed/rejected (anti-fabrication:
    // an unconfirmed link is not yet trusted as fact).
    const link =
      dump.linkStatus === "auto" || dump.linkStatus === "confirmed"
        ? (dump.goal?.title ?? dump.mission?.title ?? null)
        : null;
    const linkNote = link ? ` -> ${link}` : "";
    if (dump.summary)
      p.push(`${dump.date} [${type}]${linkNote}: ${dump.summary.slice(0, 180)}`);
    if (dump.patterns) p.push(`Patterns: ${String(dump.patterns).slice(0, 100)}`);
  }
  p.push(``);
  return p;
}
