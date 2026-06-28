/**
 * Competitive intelligence analyzer · 2026-06-20
 *
 * Applies Chanakya-style systematic exploitation of competitor
 * vulnerabilities. Architecture mirrors mental-health.ts exactly:
 * pure core computeCompetitiveIntel() + IO wrapper analyzeCompetitiveIntel().
 *
 * Inputs: competitor-scraper output, BrainMemory(competitive_intel),
 * GSC data, Google reviews.
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

// ── helpers ───────────────────────────────────────────────────────────
function round(n: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// ── types ─────────────────────────────────────────────────────────────
export interface CompetitorInput {
  name: string;
  rating: number | null;
  reviewCount: number | null;
  hasWebsite: boolean;
  responseTimeHours: number | null;
  priceLevel: string | null;
}

export interface NicksPositionInput {
  rating: number;
  reviewCount: number;
  priceLevel: string;
}

export interface GscKeywordInput {
  keyword: string;
  position: number;
  impressions: number;
  clicks: number;
}

export interface ChanakyaPrincipleInput {
  key: string;
  title: string;
  summary: string;
  triggers: string[];
}

export interface CompetitiveIntelAnalysis {
  marketPosition: {
    rank: number;
    reviewGap: { nicks: number; top: number; gap: number };
    pricingPosition: "premium" | "competitive" | "budget";
  };
  vulnerabilities: {
    competitor: string;
    weakness: string;
    exploitStrategy: string;
    chanakyaPrinciple: string;
  }[];
  opportunities: {
    keyword: string;
    position: number;
    trafficEstimate: string;
    action: string;
  }[];
  threats: {
    competitor: string;
    advantage: string;
    counterStrategy: string;
  }[];
  guidance: string[];
}

// ── pure core ─────────────────────────────────────────────────────────

export function computeCompetitiveIntel(args: {
  competitors: CompetitorInput[];
  nicks: NicksPositionInput;
  gscKeywords: GscKeywordInput[];
  chanakyaPrinciples: ChanakyaPrincipleInput[];
}): CompetitiveIntelAnalysis {
  const { competitors, nicks, gscKeywords, chanakyaPrinciples } = args;

  // ── market position ──
  const allShops = [
    { name: "Nick's Tire", rating: nicks.rating, reviewCount: nicks.reviewCount },
    ...competitors.map((c) => ({ name: c.name, rating: c.rating ?? 0, reviewCount: c.reviewCount ?? 0 })),
  ].sort((a, b) => b.rating - a.rating);
  const rank = allShops.findIndex((s) => s.name === "Nick's Tire") + 1;

  const topCompetitor = competitors
    .filter((c) => c.rating != null)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
  const topReviews = topCompetitor?.reviewCount ?? 0;
  const reviewGap = { nicks: nicks.reviewCount, top: topReviews, gap: topReviews - nicks.reviewCount };

  const pricingPosition: "premium" | "competitive" | "budget" =
    nicks.priceLevel === "low" || nicks.priceLevel === "budget" ? "budget" :
    nicks.priceLevel === "high" || nicks.priceLevel === "premium" ? "premium" : "competitive";

  // ── vulnerabilities ──
  const vulnerabilities: CompetitiveIntelAnalysis["vulnerabilities"] = [];
  for (const c of competitors) {
    const principles = chanakyaPrinciples.length > 0 ? chanakyaPrinciples : [
      { key: "ci_know_enemy", title: "Know Your Enemy", summary: "Map every weakness before acting.", triggers: [] },
    ];

    if (c.rating != null && c.rating < 4.0) {
      vulnerabilities.push({
        competitor: c.name,
        weakness: `Low rating (${c.rating} stars) — customers are dissatisfied`,
        exploitStrategy: `Target their dissatisfied customers with ads referencing our 4.9-star rating. Offer a "switch and save" promotion.`,
        chanakyaPrinciple: principles[0]?.title ?? "Know Your Enemy",
      });
    }
    if (c.reviewCount != null && c.reviewCount < 50) {
      vulnerabilities.push({
        competitor: c.name,
        weakness: `Few reviews (${c.reviewCount}) — low trust signal`,
        exploitStrategy: "Amplify our 1,700+ reviews in local search ads and GBP posts.",
        chanakyaPrinciple: principles[0]?.title ?? "Know Your Enemy",
      });
    }
    if (!c.hasWebsite) {
      vulnerabilities.push({
        competitor: c.name,
        weakness: "No website — invisible to online searchers",
        exploitStrategy: "Dominate local SEO for tire-related keywords. They can't compete online.",
        chanakyaPrinciple: principles[1]?.title ?? "Economic Warfare",
      });
    }
    if (c.responseTimeHours != null && c.responseTimeHours > 24) {
      vulnerabilities.push({
        competitor: c.name,
        weakness: `Slow response (${c.responseTimeHours}h avg) — losing impatient leads`,
        exploitStrategy: "Highlight our same-day response in VAPI and GBP. Speed wins.",
        chanakyaPrinciple: principles[1]?.title ?? "Economic Warfare",
      });
    }
  }

  // ── opportunities (GSC page-2 strikers) ──
  const opportunities: CompetitiveIntelAnalysis["opportunities"] = gscKeywords
    .filter((k) => k.position >= 11 && k.position <= 30 && k.impressions > 10)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 5)
    .map((k) => ({
      keyword: k.keyword,
      position: k.position,
      trafficEstimate: `${k.impressions} impressions/mo`,
      action: k.position <= 15
        ? "Optimize existing page — title tag, H1, internal links"
        : "Create dedicated landing page targeting this keyword",
    }));

  // ── threats ──
  const threats: CompetitiveIntelAnalysis["threats"] = competitors
    .filter((c) => c.rating != null && c.rating >= 4.5 && (c.reviewCount ?? 0) >= 200)
    .map((c) => ({
      competitor: c.name,
      advantage: `Strong reputation (${c.rating} stars, ${c.reviewCount} reviews)`,
      counterStrategy: "Differentiate on speed, price, or specialization. Don't compete on reputation alone.",
    }));

  // ── guidance ──
  const guidance: string[] = [];
  if (rank > 1) {
    guidance.push(`You're ranked #${rank} by rating. Push review generation to close the gap with #1.`);
  }
  if (reviewGap.gap > 0) {
    guidance.push(`Review gap: ${reviewGap.gap} behind top competitor. Generate ${Math.ceil(reviewGap.gap / 30)} reviews/mo to close in 1 year.`);
  }
  if (vulnerabilities.length > 0) {
    guidance.push(`${vulnerabilities.length} competitor vulnerabilities found. Focus exploit on: ${vulnerabilities[0].competitor} — ${vulnerabilities[0].weakness}.`);
  }
  if (opportunities.length > 0) {
    guidance.push(`${opportunities.length} GSC keywords on page 2-3. Quick win: "${opportunities[0].keyword}" at position ${opportunities[0].position}.`);
  }
  if (threats.length > 0) {
    guidance.push(`${threats.length} strong competitor(s). Counter ${threats[0].competitor}: ${threats[0].counterStrategy}`);
  }
  if (guidance.length === 0) {
    guidance.push("No competitor data available. Run the competitor scraper to populate this analysis.");
  }

  return {
    marketPosition: { rank, reviewGap, pricingPosition },
    vulnerabilities,
    opportunities,
    threats,
    guidance,
  };
}

// ── IO wrapper ────────────────────────────────────────────────────────

export async function analyzeCompetitiveIntel(): Promise<CompetitiveIntelAnalysis> {
  // Fetch competitor data from BrainMemory (scraper output is stored there)
  const [competitorRows, chanakyaRows, gscRows, reviewRows] = await Promise.all([
    prisma.brainMemory.findMany({
      where: { category: "competitor_snapshot", deletedAt: null },
      select: { key: true, content: true, metadata: true },
      take: 20,
    }).catch((): never[] => []),
    prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.COMPETITIVE_INTEL, deletedAt: null },
      select: { key: true, metadata: true },
      take: 10,
    }).catch((): never[] => []),
    prisma.brainMemory.findMany({
      where: { category: "gsc_summary", deletedAt: null },
      select: { key: true, metadata: true },
      take: 50,
    }).catch((): never[] => []),
    prisma.brainMemory.findMany({
      where: { category: "google_review", deletedAt: null },
      select: { key: true, content: true, metadata: true },
      take: 5,
    }).catch((): never[] => []),
  ]);

  // Parse competitors from BrainMemory
  const competitors: CompetitorInput[] = (competitorRows as unknown[]).map((r) => {
    const row = r as Record<string, unknown>;
    const meta = (row.metadata as Record<string, unknown> | null) ?? {};
    return {
      name: String(row.key ?? meta.name ?? "Unknown"),
      rating: meta.rating != null ? Number(meta.rating) : null,
      reviewCount: meta.reviewCount != null ? Number(meta.reviewCount) : null,
      hasWebsite: Boolean(meta.hasWebsite ?? false),
      responseTimeHours: meta.responseTimeHours != null ? Number(meta.responseTimeHours) : null,
      priceLevel: meta.priceLevel ? String(meta.priceLevel) : null,
    };
  });

  // Parse Chanakya principles
  const chanakyaPrinciples: ChanakyaPrincipleInput[] = (chanakyaRows as unknown[]).map((r) => {
    const row = r as Record<string, unknown>;
    const meta = (row.metadata as Record<string, unknown> | null) ?? {};
    return {
      key: String(row.key ?? ""),
      title: String(meta.title ?? ""),
      summary: String(meta.summary ?? ""),
      triggers: Array.isArray(meta.triggers) ? (meta.triggers as string[]) : [],
    };
  });

  // Parse GSC keywords
  const gscKeywords: GscKeywordInput[] = (gscRows as unknown[]).map((r) => {
    const row = r as Record<string, unknown>;
    const meta = (row.metadata as Record<string, unknown> | null) ?? {};
    return {
      keyword: String(row.key ?? meta.keyword ?? ""),
      position: meta.position != null ? Number(meta.position) : 0,
      impressions: meta.impressions != null ? Number(meta.impressions) : 0,
      clicks: meta.clicks != null ? Number(meta.clicks) : 0,
    };
  });

  // Nick's position (hardcoded from known facts — 4.9 rating, 1700+ reviews)
  const nicks: NicksPositionInput = {
    rating: 4.9,
    reviewCount: 1700,
    priceLevel: "budget",
  };

  return computeCompetitiveIntel({
    competitors,
    nicks,
    gscKeywords,
    chanakyaPrinciples,
  });
}
