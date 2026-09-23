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
 *
 *     2026-09-17 · THE NUMERATOR WAS STILL WRONG. "chosen" came from
 *     `tool_telemetry.totalCalls` — cumulative for the life of the table —
 *     while the denominator was a 30-day window. A tool useful a year ago
 *     and dead today had `totalCalls > 0` and never reached the prune
 *     list; a tool surfaced 100 times this month with one call from six
 *     months ago escaped it too. The `tool.chosen` lane supplies a
 *     WINDOWED numerator on the same traceId as `tool.surfaced`, so the
 *     two are finally the same window and unit. Falls back to the lifetime
 *     counter until that lane has measured turns, and the caveat names
 *     which of the two produced the numbers.
 *   · highFailure — ≥10 calls and success < 60%: the rewrite-draft
 *     cron's input queue (tool-description-rewrite).
 *   · stale — invoked at least once, but not in the trailing 30 days.
 *
 * Read-only. No LLM. Composed for the /system ops instrument row.
 */

import { getToolStats, type ToolStat } from "@/lib/ai/tool-telemetry";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("observability/tool-usage-census");

export interface ToolCensusRow {
  name: string;
  category: string;
  totalCalls: number;
  successRatePct: number | null;
  lastCallAt: number | null;
  lastError: string | null;
  /** Turns this tool was offered to the model in the window (null = no surfacing data). */
  surfacedCount: number | null;
  /**
   * Turns the model actually INVOKED it, over the same window as
   * `surfacedCount`. Null until the `tool.chosen` lane has measured turns —
   * null means "not measured", never "zero".
   */
  chosenCount: number | null;
}

/**
 * Per-tool CHOSEN counts from the `tool.chosen` metric lane — the numerator.
 *
 * WHY THIS EXISTS. `surfacedNeverChosen` was computed by comparing a LIFETIME
 * numerator (`tool_telemetry.totalCalls`, cumulative since the table was
 * created) against a 30-DAY denominator (`tool.surfaced`). Mixing the two makes
 * the bucket wrong in both directions:
 *
 *   · a tool that was useful a year ago and is dead today has
 *     `totalCalls > 0`, so it never reaches the prune list at all;
 *   · a tool surfaced 100 times this month with one call from six months ago
 *     reads as "invoked" and escapes the same list.
 *
 * `tool.chosen` (lib/services/chat/tool-telemetry-walk.ts) records the tools
 * actually invoked per turn, stamped with the same route-minted `traceId` as
 * `tool.surfaced`, so the two are finally the same window and the same unit.
 *
 * ⚠ ONLY `observed: true` ROWS COUNT. That lane deliberately records turns
 * whose receipts it could not see (`observed: false`), because the alternate
 * chat paths hand the walk no `ev.steps`. Counting a blind turn as a measured
 * zero would inflate "never chosen" — the exact confound this bucket exists to
 * remove, reintroduced one layer up.
 */
export interface ChosenStats {
  /** Window the counts cover, in days. */
  windowDays: number;
  /** MEASURED turns in the window (observed=true only) — the honest denominator. */
  turns: number;
  /** Turns in the window whose receipts were invisible; excluded from `turns`. */
  blindTurns: number;
  /** Oldest measured row in the window (ms epoch). */
  since: number | null;
  /** tool name → turns the model actually invoked it. */
  counts: Map<string, number>;
  /**
   * tool name → turns it was OFFERED, counted over exactly the same turns as
   * `counts`. This is the denominator the prune bucket must use, and it is not
   * the same as `SurfacedStats.counts`.
   *
   * ⚠ WHY A SECOND SURFACED COUNT EXISTS. `SurfacedStats` covers the whole
   * 30-day window; this lane only exists from the moment it deployed, and it
   * excludes blind turns. Comparing them directly means that as soon as ONE
   * observed chosen row appears, every tool with no chosen count is scored as a
   * measured zero against a MONTH of pre-instrument surfacing history — so a
   * tool offered only before the lane existed, or only on blind turns, is
   * falsely labelled "offered, never chosen". On the day the lane ships that is
   * almost the entire catalog, and the prune list would be worthless and
   * confidently wrong.
   *
   * Restricting both sides to turns that carry an OBSERVED chosen row makes
   * "offered N, chosen 0" a statement about the same set of turns. Same defect
   * family as the lifetime-vs-window mismatch this whole change fixes, one
   * level up: a numerator and a denominator drawn from different populations.
   */
  comparableSurfaced: Map<string, number>;
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
  /**
   * Denominator for `chosenCount`. `turns` counts only MEASURED turns;
   * `blindTurns` are turns whose receipts the walk could not see and which are
   * excluded from both numerator and denominator rather than counted as zero.
   */
  chosenWindow: { windowDays: number; turns: number; blindTurns: number; since: string | null };
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
  chosen: ChosenStats | null = null,
): ToolUsageCensus {
  const byName = new Map(stats.map((s) => [s.toolName, s]));
  const hasSurfacing = surfaced !== null && surfaced.turns > 0;
  const hasChosen = chosen !== null && chosen.turns > 0;

  /**
   * Was this tool chosen, over a window comparable to the surfacing window?
   *
   * When the `tool.chosen` lane has measured turns, this is a WINDOWED count
   * and the bucket below is finally apples-to-apples. Until then it falls back
   * to the lifetime counter — which is what the bucket always used, and which
   * mixes a cumulative numerator with a 30-day denominator. The fallback is
   * kept so the census keeps working before the lane accrues data, and the
   * caveat says which of the two produced the numbers.
   */
  const chosenCount = (name: string, s?: ToolStat): number =>
    hasChosen ? (chosen.counts.get(name) ?? 0) : (s?.totalCalls ?? 0);

  const toRow = (name: string, category: string, s?: ToolStat): ToolCensusRow => ({
    name,
    category,
    totalCalls: s?.totalCalls ?? 0,
    successRatePct: s && s.totalCalls > 0 ? Math.round(s.successRate * 100) : null,
    lastCallAt: s?.lastCallAt ?? null,
    lastError: s?.lastErrors?.[0]?.message ?? null,
    surfacedCount: hasSurfacing ? (surfaced.counts.get(name) ?? 0) : null,
    chosenCount: hasChosen ? (chosen.counts.get(name) ?? 0) : null,
  });

  const neverInvoked: ToolCensusRow[] = [];
  const highFailure: ToolCensusRow[] = [];
  const stale: ToolCensusRow[] = [];
  const surfacedNeverChosen: ToolCensusRow[] = [];
  const neverSurfaced: ToolCensusRow[] = [];

  for (const meta of TOOL_CATALOG) {
    const s = byName.get(meta.name);

    // The prune buckets are decided by the WINDOWED chosen count when the
    // `tool.chosen` lane has data. Before it does, this is `s.totalCalls` and
    // behaves exactly as it always has.
    //
    // ⚠ This is why the split is evaluated separately from `neverInvoked`
    // below: a tool with lifetime calls but ZERO in the window belongs in
    // `surfacedNeverChosen` (it is dead NOW), and the old code could never put
    // it there because `totalCalls > 0` sent it down the "invoked" path.
    if (hasSurfacing) {
      const row = toRow(meta.name, meta.category, s);
      // ⚠ THE DENOMINATOR MUST COME FROM THE SAME TURNS AS THE NUMERATOR.
      // When the chosen lane has data, "was it offered?" is answered over the
      // turns that lane could SEE — not over the whole 30-day surfacing window,
      // most of which predates the lane. Using the wide window would mark a
      // tool offered only before the lane existed as "offered, never chosen".
      const offeredComparably = hasChosen
        ? (chosen.comparableSurfaced.get(meta.name) ?? 0)
        : (row.surfacedCount ?? 0);
      if (offeredComparably > 0) {
        if (chosenCount(meta.name, s) === 0) surfacedNeverChosen.push(row);
      } else if (!s || s.totalCalls === 0) {
        // Never offered in the window AND never called at all — the pruner's
        // blind spot. A tool with lifetime calls but no recent surfacing is
        // not a blind spot, it is simply out of the window.
        neverSurfaced.push(row);
      }
    }

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
    chosenWindow: {
      windowDays: chosen?.windowDays ?? SURFACED_WINDOW_DAYS,
      turns: chosen?.turns ?? 0,
      blindTurns: chosen?.blindTurns ?? 0,
      since: chosen?.since ? new Date(chosen.since).toISOString() : null,
    },
    caveat: hasSurfacing
      ? `Zeros are measured over ${surfaced.turns} turns / ${surfaced.windowDays}d: "surfaced, never chosen" is the model's verdict; "never surfaced" is the pruner's blind spot, NOT evidence of uselessness. ${
          hasChosen
            ? `Chosen counts are WINDOWED from ${chosen.turns} measured turns (${chosen.blindTurns} blind turns excluded, not counted as zero).`
            : "Chosen counts fall back to LIFETIME tool_telemetry totals, so they mix a cumulative numerator with a 30d denominator — a tool useful a year ago and dead today will not appear here. The tool.chosen lane has no measured turns yet."
        } Demote to search-only via searchTools/invokeTool before considering removal — never auto-delete.`
      : "A zero is pruner-confounded: tools the pruner never surfaces cannot accumulate calls, and no surfacing data exists in the window yet. This census says 'never invoked', never 'useless'. Demote to search-only via searchTools/invokeTool before considering removal — never auto-delete.",
  };
}

/**
 * Per-tool surfaced counts from `tool.surfaced` rows (one per chat turn,
 * names in tags.tools — see prepare-tools.ts). Returns null on any query
 * failure so the census degrades to the disclosed-confound reading
 * instead of rendering a false measured-zero.
 *
 * `${days}::int` IS LOAD-BEARING (2026-09-16). Without it these two queries
 * had NEVER ONCE RUN. Prisma binds a JS number as int8; `make_interval` has
 * no int8 overload and a named-argument call gets no implicit int8 -> int4
 * cast, so every call threw 42883 and the catch below returned null every
 * time. Measured, both layers:
 *
 *   prod SQL   SELECT now() - make_interval(days => 30::bigint)
 *              -> function make_interval(days => bigint) does not exist
 *   prod rows  system_metrics WHERE metric='tool.surfaced', 30d
 *              -> 456 rows, 2026-08-25 .. 2026-09-16, none of them readable
 *   Prisma     $queryRaw`... make_interval(days => ${days})`      -> THREW 42883
 *              $queryRaw`... make_interval(days => ${days}::int)` -> OK
 *
 * So for three weeks /system/tools rendered "no surfacing data exists in the
 * window yet" over 456 rows that did exist. The zeros were honestly labelled;
 * the REASON was fabricated. Guarded by tests/repo/raw-sql-interval-cast.test.ts.
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
        AND m.created_at > now() - make_interval(days => ${days}::int)
      GROUP BY t.tool
    `;
    const meta = await prisma.$queryRaw<Array<{ turns: number; since: Date | null }>>`
      SELECT count(*)::int AS turns, min(created_at) AS since
      FROM system_metrics
      WHERE metric = 'tool.surfaced'
        AND created_at > now() - make_interval(days => ${days}::int)
    `;
    return {
      windowDays: days,
      turns: meta[0]?.turns ?? 0,
      since: meta[0]?.since ? new Date(meta[0].since).getTime() : null,
      counts: new Map(rows.map((r) => [r.tool, r.surfaced])),
    };
  } catch (e) {
    // NOT silent. Returning null is the right DEGRADATION, but it was also the
    // only thing that happened for three weeks — no log line, no metric, no
    // error row — which is why a query that could never succeed looked exactly
    // like an empty dataset. A failed read may render as "unknown"; it may not
    // pass silently.
    log.warn("surfacing_query_failed", { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/**
 * Per-tool chosen counts over the same window as `getSurfacedStats`.
 *
 * `${days}::int` IS LOAD-BEARING here for the same reason it is there: Prisma
 * binds a JS number as int8, `make_interval` has no int8 overload, and a named
 * argument gets no implicit cast — so the un-cast form throws 42883 on every
 * call and the catch turns a broken query into an innocent-looking empty
 * dataset. That cost three weeks once; it is not repeated by accident.
 *
 * `tags->>'observed' = 'true'` is the other load-bearing clause — see
 * `ChosenStats`.
 */
export async function getChosenStats(
  windowDays: number = SURFACED_WINDOW_DAYS,
): Promise<ChosenStats | null> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const days = Math.max(1, Math.min(365, Math.floor(windowDays)));
    const rows = await prisma.$queryRaw<Array<{ tool: string; chosen: number }>>`
      SELECT t.tool AS tool, count(*)::int AS chosen
      FROM system_metrics m,
           LATERAL jsonb_array_elements_text(m.tags->'tools') AS t(tool)
      WHERE m.metric = 'tool.chosen'
        AND m.tags->>'observed' = 'true'
        AND m.created_at > now() - make_interval(days => ${days}::int)
      GROUP BY t.tool
    `;
    const meta = await prisma.$queryRaw<
      Array<{ turns: number; blind: number; since: Date | null }>
    >`
      SELECT
        count(*) FILTER (WHERE tags->>'observed' = 'true')::int  AS turns,
        count(*) FILTER (WHERE tags->>'observed' <> 'true')::int AS blind,
        min(created_at) FILTER (WHERE tags->>'observed' = 'true') AS since
      FROM system_metrics
      WHERE metric = 'tool.chosen'
        AND created_at > now() - make_interval(days => ${days}::int)
    `;
    // Surfaced counts over EXACTLY the turns above — joined on the shared
    // traceId, restricted to observed chosen rows. Without this the bucket
    // compares a numerator from today against a denominator from the last 30
    // days; see `comparableSurfaced`.
    const comparable = await prisma.$queryRaw<Array<{ tool: string; surfaced: number }>>`
      SELECT t.tool AS tool, count(*)::int AS surfaced
      FROM system_metrics c
      JOIN system_metrics f
        ON f.metric = 'tool.surfaced'
       AND f.tags->>'traceId' = c.tags->>'traceId',
           LATERAL jsonb_array_elements_text(f.tags->'tools') AS t(tool)
      WHERE c.metric = 'tool.chosen'
        AND c.tags->>'observed' = 'true'
        AND c.created_at > now() - make_interval(days => ${days}::int)
      GROUP BY t.tool
    `;
    return {
      windowDays: days,
      turns: meta[0]?.turns ?? 0,
      blindTurns: meta[0]?.blind ?? 0,
      since: meta[0]?.since ? new Date(meta[0].since).getTime() : null,
      counts: new Map(rows.map((r) => [r.tool, r.chosen])),
      comparableSurfaced: new Map(comparable.map((r) => [r.tool, r.surfaced])),
    };
  } catch (e) {
    // Same rule as the surfacing read: null is the right DEGRADATION, silence
    // is not. A failed read may render as "unknown"; it may not pass as empty.
    log.warn("chosen_query_failed", { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export async function buildToolUsageCensus(): Promise<ToolUsageCensus> {
  // The telemetry table is small (≤ catalog size); pull the whole thing.
  const [stats, surfaced, chosen] = await Promise.all([
    getToolStats(500),
    getSurfacedStats(),
    getChosenStats(),
  ]);
  return assembleToolUsageCensus(stats, Date.now(), surfaced, chosen);
}
