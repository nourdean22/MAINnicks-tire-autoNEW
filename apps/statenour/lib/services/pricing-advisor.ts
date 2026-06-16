/**
 * Pricing-Strategy Advisor · v10.0.526 · Arc C Feature 3
 *
 * Surfaces categories where the shop's quote-to-invoice win rate
 * has drifted below the fleet median, pulls in competitor pricing
 * for those categories via the existing `multiSourceSearch` web-
 * search arsenal, and drafts 3 operator-graded price experiments
 * per outlier through aiChat.
 *
 * NO-DUPLICATE-DATA discipline:
 *   · Win-rate data: pulled from nickstire's existing
 *     /api/bridge/estimates-conversion?range=30d&scope=alg endpoint
 *     (NICKSTIRE-QUERY-CONTRACT v11.3 · backed by alg_estimates).
 *     That endpoint already returns per-service given/converted
 *     counts via the `byService[]` array — no second pipeline.
 *   · Competitor prices: `multiSourceSearch` (Perplexity + Tavily +
 *     Exa) per Arc-C Feature 2 (v524 #4). 24h BrainMemory cache key
 *     to avoid burning Tavily/Exa quota on repeat runs.
 *   · Wisdom: `BrainMemory(category="wisdom")` pulled with a
 *     keyword filter (inversion/munger/buffett/price) — no new
 *     wisdom table.
 *   · Output: `BrainMemory(category="pricing_advisory", key=
 *     "weekly_YYYY-MM-DD")` — NO new advisory table.
 *
 * SCOPE: ADVISORY ONLY. We never write back into nickstire pricing.
 * Operator reviews on /admin and chooses to apply manually.
 *
 * Why ALG scope (not "online"): the operator's question is about
 * walk-in pricing power — the people who saw the quote at the
 * counter and either paid or walked. The "online" funnel is
 * dominated by lead-quality filtering more than pricing.
 */

import { prisma } from "@/lib/prisma";
import { activeOnly } from "@/lib/db/soft-delete";
import { multiSourceSearch } from "@/lib/ai/multi-search";
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
import { extractJsonArray } from "@/lib/ai/extract-structured";
import { logger as rootLogger } from "@/lib/logger";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const log = rootLogger.withSurface("services/pricing-advisor");
const aiChat = makeTracedAiChat("pricing-advisor", "cron");

/* ---------- Public types ---------- */

export interface WinRateRow {
  /** Service category name as reported by ALG. */
  service: string;
  /** Estimates given in the window. */
  given: number;
  /** Estimates that converted to invoices in the window. */
  converted: number;
  /** invoices / (invoices + estimates that did NOT convert).
   *  Same as converted / given when given > 0.
   *  Returns 0 when given is 0 to keep the math safe. */
  winRate: number;
}

export interface OutlierCategory extends WinRateRow {
  /** Fleet-median win-rate at the time of detection. */
  fleetMedian: number;
  /** medianWinRate - winRate · always positive for outliers. */
  gap: number;
}

export interface CompetitorPrice {
  /** Provider that surfaced this datum. */
  source: "perplexity" | "tavily" | "exa" | "google" | "unknown";
  /** Snippet / quoted price observation. */
  snippet: string;
  /** Citation URL. */
  url: string;
}

export interface CompetitorData {
  /** Service category queried. */
  category: string;
  /** Top-3 competitor price observations (cross-source). */
  prices: CompetitorPrice[];
  /** searchWebVerified consensus, when sources agreed. */
  consensus: string | null;
  /** 0..1 · how strongly the sources agreed. */
  confidence: number;
  /** True when we served this from BrainMemory cache (≤24h old). */
  cached: boolean;
}

export interface PricingExperiment {
  hypothesis: string;
  variant: string;
  controlGroup: string;
  successMetric: string;
  wisdomCited: string;
}

export interface AdvisorySnapshot {
  schemaVersion: "pricing_advisory_v1";
  windowDays: 30;
  generatedAt: string;
  fleetMedianWinRate: number;
  winRates: WinRateRow[];
  outliers: OutlierCategory[];
  experimentsByCategory: Record<string, PricingExperiment[]>;
  /** Brief operator-facing summary line for Telegram + Ultron tile. */
  headline: string;
  /** When we couldn't compute (no data, bridge offline). */
  empty?: { reason: string };
}

/* ---------- Constants ---------- */

const OUTLIER_THRESHOLD_DEFAULT = 0.20;
const COMPETITOR_CACHE_HOURS = 24;

/* ---------- Step 1 · win-rate by service ---------- */

interface BridgeByService {
  service: string;
  given: number;
  converted: number;
  rate?: number;
}

interface BridgeEstimatesConversion {
  range: string;
  given: number;
  converted: number;
  rate: number;
  byService?: BridgeByService[];
}

/**
 * Read last-30-day ALG win-rate per service category from the
 * nickstire bridge. Returns [] when the bridge is unreachable or
 * the response is empty — caller decides whether to skip the run.
 *
 * The `winRate` field is computed locally rather than trusting the
 * bridge's `rate` (which is rounded to 1 decimal); a few outlier
 * detections sit right on the band, and we want native precision.
 */
export async function computeWinRateByCategory(): Promise<WinRateRow[]> {
  const url = process.env.NICKS_ADMIN_URL || process.env.NICKSTIRE_BRIDGE_URL;
  const key = process.env.STATENOUR_SYNC_KEY;

  if (!url || !key) {
    log.warn("bridge_creds_missing");
    return [];
  }

  try {
    const res = await fetch(
      `${url}/api/bridge/estimates-conversion?range=30d&scope=alg`,
      {
        headers: { "X-Statenour-Sync-Key": key },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) {
      log.warn("bridge_http_error", { status: res.status });
      return [];
    }
    const body = (await res.json()) as BridgeEstimatesConversion;
    const rows = body.byService ?? [];

    return rows
      .map((r): WinRateRow => {
        const given = Number(r.given) || 0;
        const converted = Number(r.converted) || 0;
        const winRate = given > 0 ? converted / given : 0;
        return { service: r.service, given, converted, winRate };
      })
      // Drop categories with < 4 estimates · n is too small for a stable rate.
      .filter((r) => r.given >= 4)
      .sort((a, b) => b.given - a.given);
  } catch (err) {
    log.warn("bridge_fetch_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/* ---------- Step 2 · outlier detection ---------- */

/**
 * Median of a non-empty number array. Pure helper · exported for
 * tests + downstream callers that want their own fleet baseline.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Returns categories whose win-rate is at least `threshold` (default
 * 20 percentage points) below the fleet median win-rate.
 *
 * Why fleet-MEDIAN (not mean): tire categories often dominate volume
 * and skew the mean down because they're price-sensitive. Median is
 * the right baseline · it answers "is THIS category an outlier vs
 * the typical category", not "is it lower than the volume-weighted
 * average".
 */
export function findOutlierCategories(
  rows: WinRateRow[],
  threshold: number = OUTLIER_THRESHOLD_DEFAULT,
): OutlierCategory[] {
  if (rows.length < 3) return []; // Need a real baseline.
  const fleetMedian = median(rows.map((r) => r.winRate));
  const outliers: OutlierCategory[] = [];
  for (const r of rows) {
    const gap = fleetMedian - r.winRate;
    if (gap >= threshold) {
      outliers.push({ ...r, fleetMedian, gap });
    }
  }
  // Worst gap first · operator should action the biggest delta.
  outliers.sort((a, b) => b.gap - a.gap);
  return outliers;
}

/* ---------- Step 3 · competitor prices ---------- */

/**
 * Pulls top-3 competitor prices for `category` near `city` via the
 * existing multiSourceSearch arsenal. 24h BrainMemory cache so a
 * weekly cron only ever burns the Tavily/Exa quota once per
 * (category, city) tuple per week.
 *
 * Never throws. Returns an empty-citation result with `cached:false`
 * when all sources fail · the caller treats that as "no competitor
 * signal this cycle" rather than an error condition.
 */
export async function getCompetitorPrices(
  category: string,
  city: string = "Cleveland",
): Promise<CompetitorData> {
  const cacheKey = `competitor_${slugify(category)}_${slugify(city)}`;

  // 1) Cache hit?
  try {
    const cached = await prisma.brainMemory.findFirst({
      where: activeOnly({
        category: "pricing_advisory",
        key: cacheKey,
      }),
      orderBy: { createdAt: "desc" },
    });
    if (cached) {
      const ageHrs = (Date.now() - cached.createdAt.getTime()) / (1000 * 3600);
      if (ageHrs < COMPETITOR_CACHE_HOURS) {
        const parsed = parseCompetitorMemory(cached.metadata);
        if (parsed) return { ...parsed, cached: true };
      }
    }
  } catch (err) {
    log.warn("competitor_cache_read_failed", {
      key: cacheKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 2) Fresh fetch.
  const query = `Typical ${category} price at an auto shop in ${city}, Ohio (US dollars, 2026). Include 2-3 specific local quotes if possible.`;
  const result = await multiSourceSearch(query, {
    recency: "year",
    // Slightly tighter timeout · weekly cron has budget but we don't
    // want a single category to block the others by 8s × 3 sources.
    timeoutMs: 6000,
  });

  const prices: CompetitorPrice[] = [];
  for (const c of result.citations.slice(0, 3)) {
    // Find a snippet from the source that contributed this citation.
    const src = result.sources.find((s) => s.name === c.source);
    const snippet = src
      ? src.content.slice(0, 240)
      : (c.title ?? "").slice(0, 240);
    prices.push({
      source: c.source,
      snippet,
      url: c.url,
    });
  }

  const data: CompetitorData = {
    category,
    prices,
    consensus: result.consensus,
    confidence: result.confidence,
    cached: false,
  };

  // 3) Persist to cache · fire-and-forget.
  prisma.brainMemory
    .create({
      data: {
        category: "pricing_advisory",
        key: cacheKey,
        content: result.consensus ?? `Competitor scan · ${category} · ${city}`,
        confidence: result.confidence,
        source: "cron:pricing-advisor",
        metadata: {
          competitorData: data,
        } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
      },
    })
    .catch((err: unknown) => {
      log.warn("competitor_cache_write_failed", {
        key: cacheKey,
        error: err instanceof Error ? err.message : String(err),
      });
    });

  return data;
}

function parseCompetitorMemory(metadata: unknown): CompetitorData | null {
  if (!metadata || typeof metadata !== "object") return null;
  const wrapped = metadata as { competitorData?: unknown };
  const data = wrapped.competitorData;
  if (!data || typeof data !== "object") return null;
  const d = data as Partial<CompetitorData>;
  if (typeof d.category !== "string") return null;
  if (!Array.isArray(d.prices)) return null;
  return {
    category: d.category,
    prices: d.prices as CompetitorPrice[],
    consensus: typeof d.consensus === "string" ? d.consensus : null,
    confidence: typeof d.confidence === "number" ? d.confidence : 0,
    cached: true,
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
}

/* ---------- Step 4 · wisdom recall ---------- */

export interface WisdomPick {
  key: string;
  content: string;
  confidence: number;
}

/**
 * Pulls the most relevant pricing-related wisdoms from BrainMemory.
 * Keyword filter · no embedding call required (we're in a weekly
 * cron, not a chat turn). Caller injects top-N into the AI prompt.
 *
 * Order: Munger (inversion) → Buffett (moat/price) → fallback.
 * That ordering matches the operator's stated preference (per
 * arsenal_integrations · Buffett/Munger as core mental-model
 * anchors).
 */
export async function recallPricingWisdoms(
  limit: number = 4,
): Promise<WisdomPick[]> {
  try {
    const wisdoms = await prisma.brainMemory.findMany({
      where: activeOnly({
        category: BRAIN_CATEGORIES.WISDOM,
        confidence: { gte: 0.5 },
        OR: [
          { content: { contains: "inversion", mode: "insensitive" } },
          { content: { contains: "munger", mode: "insensitive" } },
          { content: { contains: "buffett", mode: "insensitive" } },
          { content: { contains: "price", mode: "insensitive" } },
          { content: { contains: "moat", mode: "insensitive" } },
          { key: { contains: "munger", mode: "insensitive" } },
          { key: { contains: "buffett", mode: "insensitive" } },
        ],
      }),
      orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
      take: limit * 3,
      select: { key: true, content: true, confidence: true },
    });
    return wisdoms.slice(0, limit);
  } catch (err) {
    log.warn("wisdom_recall_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/* ---------- Step 5 · draft pricing experiments ---------- */

/**
 * Drafts 3 price experiments per outlier category via aiChat.
 * Each experiment carries a hypothesis · variant · controlGroup ·
 * successMetric · wisdomCited.
 *
 * Returns an empty array for any category whose AI response can't
 * be parsed · we never let a single hallucinated JSON block kill
 * the rest of the advisory.
 */
export async function draftPricingMoves(
  outliers: OutlierCategory[],
  competitorData: Map<string, CompetitorData>,
  wisdoms: WisdomPick[],
): Promise<Record<string, PricingExperiment[]>> {
  const out: Record<string, PricingExperiment[]> = {};
  if (outliers.length === 0) return out;

  // Pre-render the wisdom block once · it applies to every category.
  const wisdomBlock =
    wisdoms.length === 0
      ? "(no pricing wisdoms found in BrainMemory · cite Munger inversion by name in your reasoning)"
      : wisdoms
          .map((w, i) => `${i + 1}. [${w.key}] ${w.content.slice(0, 320)}`)
          .join("\n");

  for (const o of outliers) {
    const comp = competitorData.get(o.service);
    const compBlock =
      comp && comp.prices.length > 0
        ? comp.prices
            .map(
              (p, i) =>
                `[${i + 1}] (${p.source}) ${p.snippet.slice(0, 200)} — ${p.url}`,
            )
            .join("\n")
        : "(no competitor signal · operator notes own market intuition)";
    const consensus = comp?.consensus
      ? `Consensus: ${comp.consensus.slice(0, 280)}`
      : "Consensus: none.";

    const userPrompt = [
      `Service category: **${o.service}**.`,
      `Last 30d ALG win rate: ${(o.winRate * 100).toFixed(0)}% (${o.converted} of ${o.given} estimates converted).`,
      `Fleet median win rate across all categories: ${(o.fleetMedian * 100).toFixed(0)}%.`,
      `Gap below median: ${(o.gap * 100).toFixed(0)} percentage points.`,
      ``,
      `## Competitor signal (Cleveland market)`,
      compBlock,
      consensus,
      ``,
      `## Pricing wisdoms to consider`,
      wisdomBlock,
      ``,
      `Draft EXACTLY 3 price experiments to test against this category. Return ONLY a JSON array — no prose before or after — where each object has:`,
      `  hypothesis     · the testable claim (one sentence)`,
      `  variant        · the price/offer change to deploy (specific, e.g. "drop price 8%" or "bundle install + balance free")`,
      `  controlGroup   · who continues to see the current price (e.g. "first 25 estimates each week")`,
      `  successMetric  · the rate or dollar number that proves the experiment (e.g. "win rate ≥75% over 30 estimates")`,
      `  wisdomCited   · short reason citing one of the wisdoms above, OR Munger's inversion test, OR Buffett's pricing-power principle. ALWAYS cite by name.`,
      ``,
      `Constraints: variants must be operator-approvable (no automation, no auto-pricing). Mix one inversion-style move (what would GUARANTEE we lose this category? do less of that) with two upside moves.`,
    ].join("\n");

    try {
      const result = await aiChat(
        [
          {
            role: "system",
            content:
              "You are a pricing strategist embedded in an auto-shop OS. Output strict JSON arrays with no Markdown fences and no commentary. Every experiment must cite a named wisdom or principle. Never invent numeric competitor prices that weren't in the input — if absent, frame the variant as a percentage change or a bundle move.",
          },
          { role: "user", content: userPrompt },
        ],
        "reason",
      );

      const parsed = extractJsonArray<unknown>(result.content);
      if (!parsed.ok) {
        log.warn("experiment_parse_failed", {
          service: o.service,
          error: parsed.error,
        });
        out[o.service] = [];
        continue;
      }
      const validated: PricingExperiment[] = [];
      for (const raw of parsed.value) {
        if (!raw || typeof raw !== "object") continue;
        const r = raw as Record<string, unknown>;
        if (
          typeof r.hypothesis === "string" &&
          typeof r.variant === "string" &&
          typeof r.controlGroup === "string" &&
          typeof r.successMetric === "string" &&
          typeof r.wisdomCited === "string"
        ) {
          validated.push({
            hypothesis: r.hypothesis,
            variant: r.variant,
            controlGroup: r.controlGroup,
            successMetric: r.successMetric,
            wisdomCited: r.wisdomCited,
          });
        }
      }
      out[o.service] = validated.slice(0, 3);
    } catch (err) {
      log.warn("draft_failed", {
        service: o.service,
        error: err instanceof Error ? err.message : String(err),
      });
      out[o.service] = [];
    }
  }

  return out;
}

/* ---------- Top-level composer (used by cron + ad-hoc callers) ---------- */

/**
 * Runs the full advisor pipeline end-to-end. Pure composer; the
 * cron handler owns idempotency + Telegram, NOT this function.
 */
export async function composeAdvisory(opts: {
  threshold?: number;
  city?: string;
} = {}): Promise<AdvisorySnapshot> {
  const threshold = opts.threshold ?? OUTLIER_THRESHOLD_DEFAULT;
  const city = opts.city ?? "Cleveland";
  const generatedAt = new Date().toISOString();

  const winRates = await computeWinRateByCategory();
  if (winRates.length === 0) {
    return {
      schemaVersion: "pricing_advisory_v1",
      windowDays: 30,
      generatedAt,
      fleetMedianWinRate: 0,
      winRates: [],
      outliers: [],
      experimentsByCategory: {},
      headline: "No ALG estimate data available · bridge offline or no rows in 30d.",
      empty: { reason: "no_data" },
    };
  }

  const outliers = findOutlierCategories(winRates, threshold);
  const fleetMedianWinRate = outliers[0]?.fleetMedian ?? median(winRates.map((r) => r.winRate));

  if (outliers.length === 0) {
    return {
      schemaVersion: "pricing_advisory_v1",
      windowDays: 30,
      generatedAt,
      fleetMedianWinRate,
      winRates,
      outliers: [],
      experimentsByCategory: {},
      headline: `All ${winRates.length} service categories within ${(threshold * 100).toFixed(0)}pp of the ${(fleetMedianWinRate * 100).toFixed(0)}% median — no pricing intervention needed this week.`,
    };
  }

  // Pull competitor signal for up to 5 outliers · keeps Tavily/Exa
  // quota usage bounded even when the operator's market has
  // unusually wide dispersion this week.
  const focused = outliers.slice(0, 5);
  const competitorEntries = await Promise.all(
    focused.map(async (o): Promise<[string, CompetitorData]> => [
      o.service,
      await getCompetitorPrices(o.service, city),
    ]),
  );
  const competitorMap = new Map(competitorEntries);

  const wisdoms = await recallPricingWisdoms(4);
  const experimentsByCategory = await draftPricingMoves(
    focused,
    competitorMap,
    wisdoms,
  );

  const worst = focused[0];
  const headline = `Pricing advisory · ${focused.length} outlier${focused.length === 1 ? "" : "s"} (worst: ${worst.service} at ${(worst.winRate * 100).toFixed(0)}% vs ${(worst.fleetMedian * 100).toFixed(0)}% median).`;

  return {
    schemaVersion: "pricing_advisory_v1",
    windowDays: 30,
    generatedAt,
    fleetMedianWinRate,
    winRates,
    outliers: focused,
    experimentsByCategory,
    headline,
  };
}

/* ---------- test-only exports ---------- */

export const __test__ = {
  parseCompetitorMemory,
  slugify,
  OUTLIER_THRESHOLD_DEFAULT,
  COMPETITOR_CACHE_HOURS,
};
