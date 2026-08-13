/**
 * BDN-202 · tool-usage census — tools earn their place, measured.
 *
 * Derives three read models from the CANONICAL sources (tool_telemetry
 * table + TOOL_CATALOG), never a hand-list — the BDN-101 wiring-census
 * discipline applied to the tool surface:
 *
 *   · neverInvoked — catalogued tools with zero telemetry rows. A zero
 *     here is NOT proof of uselessness: the pruner (chat-mode.ts)
 *     controls visibility, so a tool the pruner never surfaces cannot
 *     accumulate calls. The panel states this caveat; the census only
 *     reports the reading. (Leverage-layer rule: check the instrument
 *     can SEE the target before reading a zero.)
 *   · highFailure — ≥10 calls and success < 60%: the rewrite-draft
 *     cron's input queue (tool-description-rewrite).
 *   · stale — invoked at least once, but not in the trailing 30 days.
 *
 * Read-only. No LLM. Composed for the /system ops instrument row.
 */

import { getToolStats, type ToolStat } from "@/lib/ai/tool-telemetry";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

export interface ToolCensusRow {
  name: string;
  category: string;
  totalCalls: number;
  successRatePct: number | null;
  lastCallAt: number | null;
  lastError: string | null;
}

export interface ToolUsageCensus {
  generatedAt: string;
  catalogSize: number;
  invokedCount: number;
  neverInvoked: ToolCensusRow[];
  highFailure: ToolCensusRow[];
  stale: ToolCensusRow[];
  /** Disclosure the panel must render — a zero is pruner-confounded. */
  caveat: string;
}

const STALE_MS = 30 * 24 * 60 * 60 * 1000;
const HIGH_FAILURE_MIN_CALLS = 10;
const HIGH_FAILURE_SUCCESS_FLOOR = 0.6;

/** Pure assembly — exported for tests; the tRPC proc feeds it live stats. */
export function assembleToolUsageCensus(
  stats: ToolStat[],
  now: number = Date.now(),
): ToolUsageCensus {
  const byName = new Map(stats.map((s) => [s.toolName, s]));

  const toRow = (name: string, category: string, s?: ToolStat): ToolCensusRow => ({
    name,
    category,
    totalCalls: s?.totalCalls ?? 0,
    successRatePct: s && s.totalCalls > 0 ? Math.round(s.successRate * 100) : null,
    lastCallAt: s?.lastCallAt ?? null,
    lastError: s?.lastErrors?.[0]?.message ?? null,
  });

  const neverInvoked: ToolCensusRow[] = [];
  const highFailure: ToolCensusRow[] = [];
  const stale: ToolCensusRow[] = [];

  for (const meta of TOOL_CATALOG) {
    const s = byName.get(meta.name);
    if (!s || s.totalCalls === 0) {
      neverInvoked.push(toRow(meta.name, meta.category, s));
      continue;
    }
    if (s.totalCalls >= HIGH_FAILURE_MIN_CALLS && s.successRate < HIGH_FAILURE_SUCCESS_FLOOR) {
      highFailure.push(toRow(meta.name, meta.category, s));
    }
    if (s.lastCallAt && now - s.lastCallAt > STALE_MS) {
      stale.push(toRow(meta.name, meta.category, s));
    }
  }

  highFailure.sort((a, b) => (a.successRatePct ?? 0) - (b.successRatePct ?? 0));
  stale.sort((a, b) => (a.lastCallAt ?? 0) - (b.lastCallAt ?? 0));

  return {
    generatedAt: new Date(now).toISOString(),
    catalogSize: TOOL_CATALOG.length,
    invokedCount: TOOL_CATALOG.length - neverInvoked.length,
    neverInvoked,
    highFailure,
    stale,
    caveat:
      "A zero is pruner-confounded: tools the pruner never surfaces cannot accumulate calls. This census says 'never invoked', never 'useless'. Demote to search-only via searchTools/invokeTool before considering removal — never auto-delete.",
  };
}

export async function buildToolUsageCensus(): Promise<ToolUsageCensus> {
  // The telemetry table is small (≤ catalog size); pull the whole thing.
  const stats = await getToolStats(500);
  return assembleToolUsageCensus(stats);
}
