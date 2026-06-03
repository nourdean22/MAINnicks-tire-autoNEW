"use client";

/**
 * RadarTab · the Radar section of the merged /market surface (Wave 2).
 *
 * Moved verbatim from the former app/(mastery)/radar/page.tsx — the only
 * change is the outer <StandardPage> wrapper became a fragment (the page-
 * level chrome now lives on /market), and the former StandardPage
 * `description` moved to an inline subtitle at the top of the fragment so
 * nothing is lost. Data fetching, the empty/loading/down states, every
 * card, the unwrap* shape projectors, and the footer are unchanged.
 *
 * Pulls via the bridge contract v11.5+:
 *   · master_report · 13-component health report, derives everything
 *
 * No new bridge action needed for Radar · the data already exists
 * inside master_report.marketing + master_report.competitive +
 * master_report.growth. This tab is a focused projection of the
 * brand/competitive slice. See apps/nickstire/server/services/
 * masterIntelligence.ts for the engine.
 *
 * Note: "top pages" here = CRM conversion (content performance). The
 * /market Search tab's "top pages" = GSC clicks — a different signal;
 * the tabs keep their own labels so the two never read as the same thing.
 */

import { MasterySectionLabel } from "@/components/mastery/mastery-section-label";
import { BridgeShell } from "@/components/mastery/bridge-shell";
import { usePollingFetch } from "@/hooks/use-polling-fetch";

// master_report engine result shape · matches
// apps/nickstire/server/services/masterIntelligence.ts EngineResult.
interface EngineResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

interface MasterReport {
  ok: true;
  timestamp: string;
  marketing: {
    channelROI: EngineResult;
    reviewVelocity: EngineResult;
    smsEngagement: EngineResult;
    leadResponse: EngineResult;
    contentPerformance: EngineResult;
  };
  growth: {
    newCustomerVelocity: EngineResult;
    referralNetwork: EngineResult;
    portfolioLTV: EngineResult;
    marketShare: EngineResult;
    seasonalDemand: EngineResult;
  };
  competitive: {
    competitorGap: EngineResult;
    chatFunnel: EngineResult;
    reviewSentiment: EngineResult;
  };
  summary: {
    topAlert: string;
    topOpportunity: string;
    topRisk: string;
    score: number;
  };
}

export function RadarTab() {
  // 2026-05-24 · Wave X.g · migrated off the inline `let cancelled /
  // setInterval` block onto the canonical `usePollingFetch` primitive.
  // Hook bonuses · tab-visibility pause (no fetch while tab is hidden)
  // · 401-bounce retry · centralized cleanup contract. The envelope
  // unwrap (`raw.data ?? raw`) inside the hook handles the bridge's
  // `{data,query,timestamp}` wrapping, so the hook returns the inner
  // `{ok,...}` MasterReport directly. 5min interval matches
  // /scoreboard NickHealthSection cadence.
  const { data: report, loading, error } = usePollingFetch<MasterReport>(
    "/api/nickstire/query?q=master_report",
    { intervalMs: 300_000 },
  );
  const bridgeOk: "loading" | "ok" | "down" =
    error || (report && report.ok !== true) ? "down" : loading && !report ? "loading" : "ok";

  if (bridgeOk === "down") return <BridgeShell title="Radar" state="down" />;
  if (bridgeOk === "loading" || !report) return <BridgeShell title="Radar" state="loading" />;

  // Extract the radar-relevant signals from master_report. We keep the
  // unknown-data unwrap explicit so changes to upstream engine shapes
  // surface as runtime nulls (the cards self-hide) rather than crashes.
  const reviewVelocity = unwrapReviewVelocity(report.marketing.reviewVelocity);
  const reviewSentiment = unwrapReviewSentiment(report.competitive.reviewSentiment);
  const competitorGap = unwrapCompetitorGap(report.competitive.competitorGap);
  const contentPerf = unwrapContentPerformance(report.marketing.contentPerformance);
  const marketShare = unwrapMarketShare(report.growth.marketShare);

  // If everything is empty there's nothing to show. Trip the down-state.
  const anyData = Boolean(
    reviewVelocity || reviewSentiment || competitorGap || contentPerf || marketShare,
  );

  return (
    <>
      <p className="text-sm text-white/60 mb-4">
        Brand + competitive signal · what&apos;s moving externally.
      </p>

        {!anyData && (
          <p className="mt-8 text-sm text-white/40">
            All radar engines returned empty. Either no recent data or the
            engines errored individually. Check /scoreboard for the per-
            engine summary.
          </p>
        )}

        {/* Brand pulse */}
        {(reviewVelocity || reviewSentiment) && (
          <section className="mt-10 space-y-3">
            <MasterySectionLabel
              label="Brand pulse"
              count={(reviewVelocity ? 1 : 0) + (reviewSentiment ? 1 : 0)}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {reviewVelocity && (
                <RadarCard
                  eyebrow="Review velocity · 30d"
                  big={`${reviewVelocity.thisMonth}`}
                  small={reviewVelocity.delta != null
                    ? `${reviewVelocity.delta > 0 ? "+" : ""}${reviewVelocity.delta} vs last 30d`
                    : "—"}
                  tone={
                    reviewVelocity.delta != null
                      ? reviewVelocity.delta > 0 ? "emerald" : reviewVelocity.delta < 0 ? "red" : "white"
                      : "white"
                  }
                />
              )}
              {reviewSentiment && (
                <RadarCard
                  eyebrow="Review sentiment"
                  big={reviewSentiment.score != null
                    ? `${reviewSentiment.score.toFixed(1)} / 5`
                    : "—"}
                  small={reviewSentiment.summary || ""}
                  tone={
                    reviewSentiment.score != null
                      ? reviewSentiment.score >= 4.5 ? "emerald"
                      : reviewSentiment.score >= 4 ? "amber" : "red"
                      : "white"
                  }
                />
              )}
            </div>
          </section>
        )}

        {/* Competitive */}
        {competitorGap && (
          <section className="mt-10 space-y-3">
            <MasterySectionLabel label="Competitive gap" count={1} />
            <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                vs. closest competitor
              </p>
              <p className="mt-2 text-[15px] text-white/85">{competitorGap.headline}</p>
              {competitorGap.detail && (
                <p className="mt-1 text-[12px] text-white/50">{competitorGap.detail}</p>
              )}
            </div>
          </section>
        )}

        {/* Market share */}
        {marketShare && (
          <section className="mt-10 space-y-3">
            <MasterySectionLabel label="Market share" count={1} />
            <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                Estimated regional share
              </p>
              <p className="mt-2 text-[24px] font-mono tabular-nums text-emerald-300">
                {marketShare.pct != null ? `${marketShare.pct.toFixed(1)}%` : "—"}
              </p>
              {marketShare.note && (
                <p className="mt-1 text-[11px] text-white/50">{marketShare.note}</p>
              )}
            </div>
          </section>
        )}

        {/* Content performance */}
        {contentPerf && contentPerf.topPages.length > 0 && (
          <section className="mt-10 space-y-3">
            <MasterySectionLabel
              label="Content performance · top pages"
              count={contentPerf.topPages.length}
            />
            <div className="rounded-lg border border-white/10 bg-white/[0.02] divide-y divide-white/[0.04]">
              {contentPerf.topPages.slice(0, 8).map((p) => (
                <div key={p.path} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-white/85 truncate font-mono">
                      {p.path}
                    </p>
                    {p.note && (
                      <p className="text-[10px] text-white/40 truncate">{p.note}</p>
                    )}
                  </div>
                  <span className="text-[13px] font-mono tabular-nums text-emerald-300 shrink-0">
                    {p.metric}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <p className="mt-12 text-[10px] uppercase tracking-[0.22em] text-white/30">
          via nickstire bridge · master_report · refreshes every 5 min
        </p>
    </>
  );
}

// ─── Inline shape projectors · keep unknown engine shapes from
//     leaking into the JSX layer. Each one returns null if its
//     engine errored or has nothing useful to show. ───

interface ReviewVelocity {
  thisMonth: number;
  delta: number | null;
}

function unwrapReviewVelocity(e: EngineResult): ReviewVelocity | null {
  if (!e.ok || !e.data) return null;
  const d = e.data as { thisMonth?: number; delta?: number | null };
  if (typeof d.thisMonth !== "number") return null;
  return { thisMonth: d.thisMonth, delta: typeof d.delta === "number" ? d.delta : null };
}

interface ReviewSentiment {
  score: number | null;
  summary: string;
}

function unwrapReviewSentiment(e: EngineResult): ReviewSentiment | null {
  if (!e.ok || !e.data) return null;
  const d = e.data as { score?: number | null; summary?: string };
  return {
    score: typeof d.score === "number" ? d.score : null,
    summary: typeof d.summary === "string" ? d.summary : "",
  };
}

interface CompetitorGap {
  headline: string;
  detail: string;
}

function unwrapCompetitorGap(e: EngineResult): CompetitorGap | null {
  if (!e.ok || !e.data) return null;
  const d = e.data as {
    headline?: string;
    detail?: string;
    gap?: string;
    summary?: string;
  };
  const headline = d.headline || d.gap || d.summary;
  if (!headline) return null;
  return { headline, detail: d.detail || "" };
}

interface MarketShare {
  pct: number | null;
  note: string;
}

function unwrapMarketShare(e: EngineResult): MarketShare | null {
  if (!e.ok || !e.data) return null;
  const d = e.data as { pct?: number | null; share?: number; note?: string };
  const pct = typeof d.pct === "number" ? d.pct : typeof d.share === "number" ? d.share : null;
  if (pct == null) return null;
  return { pct, note: d.note || "" };
}

interface ContentPerformance {
  topPages: Array<{ path: string; metric: string; note?: string }>;
}

function unwrapContentPerformance(e: EngineResult): ContentPerformance | null {
  if (!e.ok || !e.data) return null;
  const d = e.data as { topPages?: Array<{ path?: string; metric?: string | number; note?: string }> };
  if (!Array.isArray(d.topPages)) return null;
  const topPages = d.topPages
    .filter((p) => typeof p.path === "string" && p.path.length > 0)
    .map((p) => ({
      path: p.path as string,
      metric: String(p.metric ?? ""),
      note: typeof p.note === "string" ? p.note : undefined,
    }));
  if (topPages.length === 0) return null;
  return { topPages };
}

/**
 * Inline brand-pulse card · matches /seo Kpi visual but adds an
 * eyebrow + small subtitle line. 4 supported tones.
 */
function RadarCard({
  eyebrow,
  big,
  small,
  tone,
}: {
  eyebrow: string;
  big: string;
  small: string;
  tone: "emerald" | "amber" | "red" | "white";
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "amber"
      ? "text-amber-300"
      : tone === "red"
      ? "text-red-300"
      : "text-white";
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">{eyebrow}</p>
      <p className={`mt-1 text-[20px] font-medium tabular-nums ${toneClass}`}>{big}</p>
      {small && <p className="mt-0.5 text-[11px] text-white/50">{small}</p>}
    </div>
  );
}
