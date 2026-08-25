/**
 * BDN-202 · tool-usage census — tools earn their place, measured.
 *
 * Derives read models from the CANONICAL sources (tool_telemetry table +
 * TOOL_CATALOG + the `tool.surfaced` system_metrics lane), never a
 * hand-list — the BDN-101 wiring-census discipline applied to the tool
 * surface:
 *
 *   · neverInvoked — catalogued tools with zero telemetry rows. Before
 *     2026-08-25 this was the only zero bucket and it was CONFOUNDED:
 *     the pruner (chat-mode.ts) controls visibility, so a tool the
 *     pruner never surfaces cannot accumulate calls. (Leverage-layer
 *     rule: check the instrument can SEE the target before reading a
 *     zero.)
 *   · surfacedNeverChosen / neverSurfaced — the confound RESOLVED,
 *     using per-turn `tool.surfaced` metrics (prepare-tools.ts records
 *     the final offered set). "Offered N times, chosen zero" and
 *     "never offered" have opposite meanings for a prune decision, so
 *     they are separate buckets, each carrying its denominator
 *     (surfacedWindow.turns). Both stay EMPTY until surfacing data
 *     exists — an absent instrument must not read as a measured zero.
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
  /** Turns this tool was offered to the model in the window (null = no surfacing data). */
  surfacedCount: number | null;
}

/** Per-tool surfaced counts from the `tool.surfaced` metric lane. */
export interface SurfacedStats {
  /** Window the counts cover, in days. */
  windowDays: number;
  /** Chat turns observed in the window — the denominator for every count. */
  turns: number;
  /** Oldest surfacing row in the window (ms epoch) — "measuring since". */
  since: number | null;
  /** tool name → turns it appeared in the final offered set. */
  counts: Map<string, number>;
}

export interface ToolUsageCensus {
  generatedAt: string;
  catalogSize: number;
  invokedCount: number;
  neverInvoked: ToolCensusRow[];
  highFailure: ToolCensusRow[];
  stale: ToolCensusRow[];
  /** Offered ≥1 turn in the window, never chosen by the model — the actionable prune list. */
  surfacedNeverChosen: ToolCensusRow[];
  /** Never offered in the window AND zero lifetime calls — the pruner's blind spot, not the model's verdict. */
  neverSurfaced: ToolCensusRow[];
  /** Denominators for the two buckets above; turns=0 means the instrument has no data yet. */
  surfacedWindow: { windowDays: number; turns: number; since: string | null };
  /** Disclosure the panel must render — states whether zeros are measured or confounded. */
  caveat: string;
}

const STALE_MS = 30 * 24 * 60 * 60 * 1000;
const HIGH_FAILURE_MIN_CALLS = 10;
const HIGH_FAILURE_SUCCESS_FLOOR = 0.6;
const SURFACED_WINDOW_DAYS = 30;

/** Pure assembly — exported for tests; the tRPC proc feeds it live stats. */
export function assembleToolUsageCensus(
  stats: ToolStat[],
  now: number = Date.now(),
  surfaced: SurfacedStats | null = null,
): ToolUsageCensus {
  const byName = new Map(stats.map((s) => [s.toolName, s]));
  const hasSurfacing = surfaced !== null && surfaced.turns > 0;

  const toRow = (name: string, category: string, s?: ToolStat): ToolCensusRow => ({
    name,
    category,
    totalCalls: s?.totalCalls ?? 0,
    successRatePct: s && s.totalCalls > 0 ? Math.round(s.successRate * 100) : null,
    lastCallAt: s?.lastCallAt ?? null,
    lastError: s?.lastErrors?.[0]?.message ?? null,
    surfacedCount: hasSurfacing ? (surfaced.counts.get(name) ?? 0) : null,
  });

  const neverInvoked: ToolCensusRow[] = [];
  const highFailure: ToolCensusRow[] = [];
  const stale: ToolCensusRow[] = [];
  const surfacedNeverChosen: ToolCensusRow[] = [];
  const neverSurfaced: ToolCensusRow[] = [];

  for (const meta of TOOL_CATALOG) {
    const s = byName.get(meta.name);
    if (!s || s.totalCalls === 0) {
      const row = toRow(meta.name, meta.category, s);
      neverInvoked.push(row);
      if (hasSurfacing) {
        if ((row.surfacedCount ?? 0) > 0) surfacedNeverChosen.push(row);
        else neverSurfaced.push(row);
      }
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
  // Most-offered-never-chosen first: the strongest evidence of a tool the
  // model sees constantly and declines is the strongest prune candidate.
  surfacedNeverChosen.sort((a, b) => (b.surfacedCount ?? 0) - (a.surfacedCount ?? 0));

  return {
    generatedAt: new Date(now).toISOString(),
    catalogSize: TOOL_CATALOG.length,
    invokedCount: TOOL_CATALOG.length - neverInvoked.length,
    neverInvoked,
    highFailure,
    stale,
    surfacedNeverChosen,
    neverSurfaced,
    surfacedWindow: {
      windowDays: surfaced?.windowDays ?? SURFACED_WINDOW_DAYS,
      turns: surfaced?.turns ?? 0,
      since: surfaced?.since ? new Date(surfaced.since).toISOString() : null,
    },
    caveat: hasSurfacing
      ? `Zeros are measured over ${surfaced.turns} turns / ${surfaced.windowDays}d: "surfaced, never chosen" is the model's verdict; "never surfaced" is the pruner's blind spot, NOT evidence of uselessness. Demote to search-only via searchTools/invokeTool before considering removal — never auto-delete.`
      : "A zero is pruner-confounded: tools the pruner never surfaces cannot accumulate calls, and no surfacing data exists in the window yet. This census says 'never invoked', never 'useless'. Demote to search-only via searchTools/invokeTool before considering removal — never auto-delete.",
  };
}

/**
 * Per-tool surfaced counts from `tool.surfaced` rows (one per chat turn,
 * names in tags.tools — see prepare-tools.ts). Returns null on any query
 * failure so the census degrades to the disclosed-confound reading
 * instead of rendering a false measured-zero.
 */
export async function getSurfacedStats(
  windowDays: number = SURFACED_WINDOW_DAYS,
): Promise<SurfacedStats | null> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const days = Math.max(1, Math.min(365, Math.floor(windowDays)));
    const rows = await prisma.$queryRaw<Array<{ tool: string; surfaced: number }>>`
      SELECT t.tool AS tool, count(*)::int AS surfaced
      FROM system_metrics m,
           LATERAL jsonb_array_elements_text(m.tags->'tools') AS t(tool)
      WHERE m.metric = 'tool.surfaced'
        AND m.created_at > now() - make_interval(days => ${days})
      GROUP BY t.tool
    `;
    const meta = await prisma.$queryRaw<Array<{ turns: number; since: Date | null }>>`
      SELECT count(*)::int AS turns, min(created_at) AS since
      FROM system_metrics
      WHERE metric = 'tool.surfaced'
        AND created_at > now() - make_interval(days => ${days})
    `;
    return {
      windowDays: days,
      turns: meta[0]?.turns ?? 0,
      since: meta[0]?.since ? new Date(meta[0].since).getTime() : null,
      counts: new Map(rows.map((r) => [r.tool, r.surfaced])),
    };
  } catch {
    return null;
  }
}

export async function buildToolUsageCensus(): Promise<ToolUsageCensus> {
  // The telemetry table is small (≤ catalog size); pull the whole thing.
  const [stats, surfaced] = await Promise.all([getToolStats(500), getSurfacedStats()]);
  return assembleToolUsageCensus(stats, Date.now(), surfaced);
}
