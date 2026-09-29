import { and, desc, eq, inArray, isNotNull, like, ne, sql } from "drizzle-orm";
import type { DB } from "../db";
import {
  igMetricSnapshots,
  instagramAnalytics,
  mediaAssets,
  reelJobs,
  shopSettings,
} from "../../drizzle/schema";
import {
  APPROVED_REEL_PACKS,
  buildApprovedPackBriefForTest,
  readActiveReelSlate,
  resolveApprovedPackRotationIndex,
} from "./approvedReelPackRotation";
import { parseReelJobPayload } from "../../shared/reelJobPayload";
import {
  compareAllSignals,
  type SignalMetricComparison,
  type SwipeFileMetric,
} from "../../shared/attentionMicrostructure";
import { getSwipeFileSamples } from "./attentionMicrostructureStore";
import {
  parseJudgeRow,
  parseQcRow,
  summarizeReelShadow,
  type ReelShadowRow,
} from "./reelShadowReadout";
import { getInstagramAccount, getInstagramPosts } from "../instagram";
import { BUSINESS } from "../../shared/business";
import { gatherTopicSignals } from "./contentTopicSignals";
import { isNearDuplicate, mineTopicCandidates, type TopicCandidate } from "../../shared/contentTopicMiner";

type OutcomeMetric = {
  reach: number | null;
  saved: number | null;
  shares: number | null;
  skipRate: number | null;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const rate = (count: number | null, reach: number | null): number | null =>
  count !== null && reach !== null && reach > 0 ? count / reach : null;

function packDate(slug: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})-/.exec(slug);
  return m?.[1] ?? null;
}

function bestDemandMatch(topic: string, candidates: TopicCandidate[]): TopicCandidate | null {
  const matches = candidates
    .filter((candidate) =>
      isNearDuplicate(topic, [candidate.topic])
      || isNearDuplicate(candidate.topic, [topic]),
    )
    .sort((a, b) => b.score - a.score);
  return matches[0] ?? null;
}

let packMetaCache: Array<{
  slug: string;
  topic: string;
  packDate: string | null;
  noveltySimilarity: number | null;
  productionTwin: boolean;
  collisions: string[];
  nearestSignature: string | null;
}> | null = null;
function packMeta() {
  if (packMetaCache) return packMetaCache;
  packMetaCache = APPROVED_REEL_PACKS.map((pack) => {
    const brief = buildApprovedPackBriefForTest(pack.slug) as {
      productionGrammarNovelty?: {
        similarity?: number;
        isProductionTwin?: boolean;
        collisions?: string[];
        nearestSignature?: string | null;
      };
    } | null;
    const novelty = brief?.productionGrammarNovelty;
    return {
      slug: pack.slug,
      topic: pack.topic,
      packDate: packDate(pack.slug),
      noveltySimilarity: num(novelty?.similarity),
      productionTwin: novelty?.isProductionTwin === true,
      collisions: Array.isArray(novelty?.collisions) ? novelty!.collisions!.slice(0, 5) : [],
      nearestSignature: novelty?.nearestSignature ?? null,
    };
  });
  return packMetaCache;
}

async function latestMetrics(database: DB, postIds: string[]): Promise<Map<string, OutcomeMetric>> {
  const out = new Map<string, OutcomeMetric>();
  if (!postIds.length) return out;
  const ids = [...new Set(postIds)].slice(0, 500);
  const [analyticsRows, snapshotRows] = await Promise.all([
    database.select({
      postId: instagramAnalytics.postId,
      reach: instagramAnalytics.reach,
      saved: instagramAnalytics.saved,
      shares: instagramAnalytics.shares,
    }).from(instagramAnalytics)
      .where(inArray(instagramAnalytics.postId, ids))
      .orderBy(desc(instagramAnalytics.createdAt)),
    database.select({
      postId: igMetricSnapshots.postId,
      reach: igMetricSnapshots.reach,
      saved: igMetricSnapshots.saved,
      shares: igMetricSnapshots.shares,
      skipRate: igMetricSnapshots.skipRate,
      capturedAt: igMetricSnapshots.capturedAt,
    }).from(igMetricSnapshots)
      .where(inArray(igMetricSnapshots.postId, ids))
      .orderBy(desc(igMetricSnapshots.capturedAt))
      .limit(2500),
  ]);
  // Append-only snapshots are the strongest time-stamped outcome record.
  // Prefer the newest snapshot wholesale; fall back to the current analytics
  // row only for posts that predate snapshot accrual.
  for (const row of snapshotRows) {
    if (out.has(row.postId)) continue;
    out.set(row.postId, {
      reach: num(row.reach),
      saved: num(row.saved),
      shares: num(row.shares),
      skipRate: num(row.skipRate),
    });
  }
  for (const row of analyticsRows) {
    if (out.has(row.postId)) continue;
    out.set(row.postId, {
      reach: num(row.reach),
      saved: num(row.saved),
      shares: num(row.shares),
      skipRate: null,
    });
  }
  return out;
}
export function recommendedSlateOrder<T extends {
  slug: string;
  packDate: string | null;
  productionTwin: boolean;
  noveltySimilarity: number | null;
  publishedCount: number;
  demandScore?: number | null;
  outcome: OutcomeMetric | null;
}>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => {
    if ((a.publishedCount === 0) !== (b.publishedCount === 0)) return a.publishedCount === 0 ? -1 : 1;
    if (a.productionTwin !== b.productionTwin) return a.productionTwin ? 1 : -1;
    // Reuse the live topic miner as a CURRENT-demand/timeliness signal, but
    // only after the two strongest editorial constraints above. No match means
    // unknown demand, not zero demand.
    const ad = a.demandScore ?? Number.NEGATIVE_INFINITY;
    const bd = b.demandScore ?? Number.NEGATIVE_INFINITY;
    if (ad !== bd) return bd - ad;
    const an = a.noveltySimilarity ?? 2;
    const bn = b.noveltySimilarity ?? 2;
    if (an !== bn) return an - bn;
    const aSave = rate(a.outcome?.saved ?? null, a.outcome?.reach ?? null) ?? -1;
    const bSave = rate(b.outcome?.saved ?? null, b.outcome?.reach ?? null) ?? -1;
    if (aSave !== bSave) return bSave - aSave;
    return String(b.packDate ?? "").localeCompare(String(a.packDate ?? ""));
  });
}

export async function buildActiveSlateStrategy(database: DB) {
  const [active, cursorRows, publishedJobs, realMediaRows, signalReport] = await Promise.all([
    readActiveReelSlate(database),
    database.select({ value: shopSettings.value }).from(shopSettings)
      .where(eq(shopSettings.key, "reel_approved_pack_rotation_index")).limit(1),
    database.select({
      id: reelJobs.id,
      payload: reelJobs.payload,
      postId: reelJobs.igPostId,
      updatedAt: reelJobs.updatedAt,
    }).from(reelJobs)
      .where(and(isNotNull(reelJobs.igPostId), ne(reelJobs.igPostId, "")))
      .orderBy(desc(reelJobs.updatedAt))
      .limit(500),
    database.select({ n: sql<number>`count(*)` }).from(mediaAssets)
      .where(and(
        eq(mediaAssets.rightsStatus, "real_shop"),
        eq(mediaAssets.isCurrent, 1),
        eq(mediaAssets.reuseAllowed, 1),
        like(mediaAssets.mimeType, "image/%"),
        isNotNull(mediaAssets.runtimeUrl),
        inArray(mediaAssets.lifecycleState, ["available", "quality_review", "approval_ready", "approved", "published"]),
      )),
    gatherTopicSignals(),
  ]);
  const liveTopicCandidates = mineTopicCandidates(signalReport.signals);

  const histories = new Map<string, Array<{ postId: string; updatedAt: Date }>>();
  for (const job of publishedJobs) {
    const parsed = parseReelJobPayload(job.payload);
    const slug = parsed.approvedPackSlug;
    if (!slug || !job.postId) continue;
    const list = histories.get(slug) ?? [];
    list.push({ postId: job.postId, updatedAt: job.updatedAt });
    histories.set(slug, list);
  }
  const postIds = [...histories.values()].flat().map((r) => r.postId);
  const metricByPost = await latestMetrics(database, postIds);
  const candidates = packMeta().map((meta) => {
    const history = histories.get(meta.slug) ?? [];
    const latest = history.slice().sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
    const outcome = latest ? (metricByPost.get(latest.postId) ?? null) : null;
    const demand = bestDemandMatch(meta.topic, liveTopicCandidates);
    const reasons: string[] = [];
    if (!history.length) reasons.push("not previously published from this approved pack");
    else reasons.push(`published ${history.length} time(s); repeat cost is explicit`);
    if (meta.productionTwin) reasons.push("structure fingerprint collides with recent approved-pack grammar");
    else if (meta.noveltySimilarity !== null) reasons.push(`structure similarity ${meta.noveltySimilarity.toFixed(2)} vs prior-pack window`);
    if (demand) reasons.push(`live demand/timeliness match: ${demand.source} score ${demand.score} · ${demand.topic}`);
    if (outcome?.reach) reasons.push(`prior exact-pack reach ${outcome.reach}`);
    if (outcome?.saved !== null && outcome?.reach) reasons.push(`prior saves/reach ${(outcome.saved / outcome.reach).toFixed(4)}`);
    return {
      ...meta,
      activeRank: active.slugs.indexOf(meta.slug),
      publishedCount: history.length,
      lastPublishedAt: latest?.updatedAt.toISOString() ?? null,
      demandScore: demand?.score ?? null,
      demandSource: demand?.source ?? null,
      demandTopic: demand?.topic ?? null,
      outcome,
      reasons,
    };
  });
  const recommended = recommendedSlateOrder(candidates);
  const fullLibraryCursor = resolveApprovedPackRotationIndex(cursorRows[0]?.value ? String(cursorRows[0].value) : null);
  return {
    active,
    fullLibraryCursor,
    realShopMediaCount: Number(realMediaRows[0]?.n ?? 0),
    candidates,
    recommendedSlugs: recommended.slice(0, 12).map((r) => r.slug),
    rankingBasis: [
      "never-published approved packs before repeats",
      "non-colliding production grammar before production twins",
      "current live-topic demand/timeliness match from the existing miner",
      "lower structure similarity before higher similarity",
      "exact-pack saves/reach only when a prior published instance has measured reach",
      "newer reviewed pack date only as the final tie-break",
    ],
    demandSignal: {
      candidateCount: liveTopicCandidates.length,
      failedSources: signalReport.failed,
      emptySources: signalReport.empty,
    },
    unknowns: [
      "topic-to-demand matching is conservative word-overlap; an unmatched pack means unknown demand, not zero demand",
      "real-shop media is counted globally because uploaded evidence is not semantically tagged to a pack",
      "this ordering is an editorial heuristic, not a virality or outcome forecast",
    ],
  };
}

export interface StructureHypothesis {
  family: string;
  signal: string;
  metric: SwipeFileMetric;
  delta: number;
  withN: number;
  withoutN: number;
  direction: "beneficial_in_sample" | "costly_in_sample";
  statement: string;
}
export function structureHypothesesFromComparisons(comparisons: SignalMetricComparison[]): StructureHypothesis[] {
  return comparisons
    .filter((c) => c.sufficient && c.delta !== null)
    .map((c) => {
      const beneficial = c.metric === "skipRate" ? (c.delta as number) < 0 : (c.delta as number) > 0;
      const metricLabel = c.metric === "skipRate" ? "skip rate" : c.metric === "savesPerReach" ? "saves per reach" : "shares per reach";
      const direction = beneficial ? "beneficial_in_sample" as const : "costly_in_sample" as const;
      return {
        family: c.family,
        signal: c.signal,
        metric: c.metric,
        delta: c.delta as number,
        withN: c.withN,
        withoutN: c.withoutN,
        direction,
        statement: `In the current measured sample, reels WITH ${c.signal} had ${beneficial ? "a more favorable" : "a less favorable"} ${metricLabel} than reels without it. Treat this as a testable prior, not a causal rule.`,
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 12);
}

export async function buildStructureHypotheses() {
  const samples = await getSwipeFileSamples();
  const metrics: SwipeFileMetric[] = ["savesPerReach", "sharesPerReach", "skipRate"];
  const comparisons = metrics.flatMap((metric) => compareAllSignals(samples, metric));
  return {
    sampleCount: samples.length,
    hypotheses: structureHypothesesFromComparisons(comparisons),
    contract: "correlation-only; use as an experiment/prior, never as an automatic publish rule",
  };
}

export interface JudgeOutcomeCohort {
  n: number;
  avgSkipRateRaw: number | null;
  avgSavesPerReach: number | null;
  avgSharesPerReach: number | null;
}

function cohort(rows: Array<{ row: ReelShadowRow; metrics: OutcomeMetric | null }>, bucket: "would_block" | "clear"): JudgeOutcomeCohort {
  const selected = rows.filter((x) => x.row.bucket === bucket && x.metrics);
  const avg = (getter: (m: OutcomeMetric) => number | null) => {
    const xs = selected.map((x) => getter(x.metrics as OutcomeMetric)).filter((v): v is number => v !== null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  return {
    n: selected.length,
    avgSkipRateRaw: avg((m) => m.skipRate),
    avgSavesPerReach: avg((m) => rate(m.saved, m.reach)),
    avgSharesPerReach: avg((m) => rate(m.shares, m.reach)),
  };
}

export function judgeOutcomeAlignment(wouldBlock: JudgeOutcomeCohort, clear: JudgeOutcomeCohort) {
  const specs = [
    { key: "skip_rate", blocked: wouldBlock.avgSkipRateRaw, clear: clear.avgSkipRateRaw, blockedShouldBe: "higher" as const },
    { key: "saves_per_reach", blocked: wouldBlock.avgSavesPerReach, clear: clear.avgSavesPerReach, blockedShouldBe: "lower" as const },
    { key: "shares_per_reach", blocked: wouldBlock.avgSharesPerReach, clear: clear.avgSharesPerReach, blockedShouldBe: "lower" as const },
  ];
  const metrics = specs.flatMap((spec) => {
    if (spec.blocked === null || spec.clear === null) return [];
    const delta = spec.blocked - spec.clear;
    const alignment = delta === 0
      ? "neutral"
      : spec.blockedShouldBe === "higher"
        ? (delta > 0 ? "judge_consistent" : "contrary")
        : (delta < 0 ? "judge_consistent" : "contrary");
    return [{ metric: spec.key, blockedAvg: spec.blocked, clearAvg: spec.clear, delta, alignment }];
  });
  const consistent = metrics.filter((m) => m.alignment === "judge_consistent").length;
  const contrary = metrics.filter((m) => m.alignment === "contrary").length;
  const enoughRows = wouldBlock.n >= 5 && clear.n >= 5;
  const status =
    !enoughRows || metrics.length < 2
      ? "insufficient_outcome_sample"
      : contrary >= 2 && contrary > consistent
        ? "not_supported_by_current_outcomes"
        : consistent >= 2 && contrary === 0
          ? "directionally_aligned_needs_controlled_validation"
          : "mixed_outcomes";
  return {
    status,
    metrics,
    consistent,
    contrary,
    enoughRows,
    hardGateSupported: false,
    note: status === "not_supported_by_current_outcomes"
      ? "Current descriptive outcomes run against a hard-gate promotion: the judge-blocked cohort looks better on most comparable downstream metrics. Keep the judge in shadow mode."
      : status === "directionally_aligned_needs_controlled_validation"
        ? "Current descriptive outcomes point in the judge's expected direction, but observational cohorts do not establish causality or calibration. Keep shadow mode until a controlled validation supports promotion."
        : status === "mixed_outcomes"
          ? "Downstream outcomes are mixed. Keep shadow mode; there is no defensible hard-gate promotion signal."
          : "There is not enough measured downstream outcome evidence to assess promotion. Keep shadow mode.",
  };
}

export async function buildReelJudgeCalibration(database: DB) {
  const kv = await database.select({ key: shopSettings.key, value: shopSettings.value })
    .from(shopSettings)
    .where(sql`${shopSettings.key} LIKE 'reel_shadow_judge_%' OR ${shopSettings.key} LIKE 'reel_qc_checklist_%'`)
    .limit(1000);
  const judge = kv.map((r) => parseJudgeRow(r.key, r.value)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const qc = kv.map((r) => parseQcRow(r.key, r.value)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const outcomes = await database.select({
    jobId: reelJobs.id,
    status: reelJobs.status,
    postId: reelJobs.igPostId,
    briefId: reelJobs.briefId,
  }).from(reelJobs).orderBy(desc(reelJobs.createdAt), desc(reelJobs.id)).limit(1000);
  const summary = summarizeReelShadow({
    judge,
    qc,
    outcomes: outcomes.map((o) => ({ jobId: o.jobId, status: o.status, igPostId: o.postId, briefId: o.briefId })),
  });
  const metricMap = await latestMetrics(database, outcomes.flatMap((o) => o.postId ? [o.postId] : []));
  const postByJob = new Map(outcomes.map((o) => [o.jobId, o.postId]));
  const calibrated = summary.rows
    .filter((row) => row.published === true && row.bucket !== "no_verdict")
    .map((row) => ({ row, metrics: postByJob.get(row.jobId) ? metricMap.get(postByJob.get(row.jobId) as string) ?? null : null }));
  const wouldBlock = cohort(calibrated, "would_block");
  const clear = cohort(calibrated, "clear");
  const coverageRate = summary.coverage?.published
    ? summary.coverage.withVerdict / summary.coverage.published
    : null;
  const alignment = judgeOutcomeAlignment(wouldBlock, clear);
  const enoughOutcomeRows = wouldBlock.n >= 5 && clear.n >= 5;
  return {
    summary,
    outcomeCohorts: { wouldBlock, clear },
    outcomeAlignment: alignment,
    calibrationReadiness: {
      evidenceReadyForOperatorDecision: Boolean(coverageRate !== null && coverageRate >= 0.9 && enoughOutcomeRows),
      hardGateSupported: false,
      coverageRate,
      enoughOutcomeRows,
      rule: "requires >=90% eligible-post verdict coverage and >=5 published measured rows in both judge cohorts merely to REVIEW the question; a hard-gate promotion still needs outcome alignment plus controlled validation",
    },
  };
}

export function chooseProfileCandidates(rows: Array<{
  postId: string;
  caption: string | null;
  reach: number | null;
  saved: number | null;
  shares: number | null;
  skipRate: number | null;
}>) {
  const valid = rows.filter((r) => (r.reach ?? 0) > 0);
  const picks: Array<{ role: string; row: typeof rows[number]; evidence: string }> = [];
  const push = (role: string, sorted: typeof rows, evidence: (r: typeof rows[number]) => string) => {
    const row = sorted.find((r) => !picks.some((p) => p.row.postId === r.postId));
    if (row) picks.push({ role, row, evidence: evidence(row) });
  };
  push("discovery", valid.slice().sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0)), (r) => `${r.reach} reach`);
  const withSaves = valid.filter((r) => r.saved !== null);
  const withShares = valid.filter((r) => r.shares !== null);
  push("save_value", withSaves.slice().sort((a, b) => (rate(b.saved, b.reach) ?? -1) - (rate(a.saved, a.reach) ?? -1)), (r) => `${(rate(r.saved, r.reach) as number).toFixed(4)} saves/reach`);
  push("share_value", withShares.slice().sort((a, b) => (rate(b.shares, b.reach) ?? -1) - (rate(a.shares, a.reach) ?? -1)), (r) => `${(rate(r.shares, r.reach) as number).toFixed(4)} shares/reach`);
  const withSkip = valid.filter((r) => r.skipRate !== null);
  push("retention", withSkip.slice().sort((a, b) => (a.skipRate as number) - (b.skipRate as number)), (r) => `skip-rate raw ${r.skipRate}`);
  return picks;
}
export async function buildProfileMerchandising(database: DB) {
  const [account, feed, analyticsRows] = await Promise.all([
    getInstagramAccount(),
    getInstagramPosts(18),
    database.select({
      postId: instagramAnalytics.postId,
      caption: instagramAnalytics.caption,
      reach: instagramAnalytics.reach,
      saved: instagramAnalytics.saved,
      shares: instagramAnalytics.shares,
      mediaProductType: instagramAnalytics.mediaProductType,
      createdAt: instagramAnalytics.createdAt,
    }).from(instagramAnalytics)
      .orderBy(desc(instagramAnalytics.createdAt))
      .limit(150),
  ]);
  const metricMap = await latestMetrics(database, analyticsRows.map((r) => r.postId));
  const seen = new Set<string>();
  const rows = analyticsRows.flatMap((r) => {
    if (seen.has(r.postId)) return [];
    seen.add(r.postId);
    const latest = metricMap.get(r.postId);
    return [{
      postId: r.postId,
      caption: r.caption,
      reach: latest?.reach ?? num(r.reach),
      saved: latest?.saved ?? num(r.saved),
      shares: latest?.shares ?? num(r.shares),
      skipRate: latest?.skipRate ?? null,
    }];
  });
  const feedById = new Map(feed.map((post) => [post.id, post]));
  const pinCandidates = chooseProfileCandidates(rows).map((candidate) => {
    const live = feedById.get(candidate.row.postId);
    return {
      ...candidate,
      link: live?.link ?? null,
      mediaUrl: live?.mediaUrl ?? null,
    };
  });
  const coverReview = feed
    .filter((p) => p.mediaProductType === "REELS" || p.type === "VIDEO")
    .slice(0, 12)
    .map((post) => ({
      ...post,
      metrics: metricMap.get(post.id) ?? { reach: null, saved: null, shares: null, skipRate: null },
    }));
  const recommendedBio = [
    "Tires • Brakes • Auto Repair",
    `${BUSINESS.address.city}, ${BUSINESS.address.state} • Open 7 days`,
    "Walk-ins welcome • Call or book ↓",
  ].join("\n");
  return {
    account,
    bioReview: {
      currentBio: account?.bio ?? null,
      currentWebsite: account?.website ?? null,
      recommendedBio,
      hierarchy: [
        "What you do: tires, brakes, and auto repair",
        "Where: Euclid / Cleveland-area relevance",
        "Why trust: use only current, provable shop proof",
        "One action: call or book through the profile link",
      ],
      note: account
        ? "Current account metadata came from the app's Instagram account reader; the suggested bio uses only BUSINESS source-of-truth facts."
        : "Current bio metadata is unavailable on this container; do not treat that as an empty bio. The suggested bio still uses only BUSINESS source-of-truth facts.",
    },
    pinCandidates,
    coverReview,
    highlightPlan: [
      { label: "Reviews", purpose: "trust proof from real customer language" },
      { label: "Tires", purpose: "core product + repair education" },
      { label: "Brakes", purpose: "high-intent repair education" },
      { label: "E-Check", purpose: "local Cleveland compliance demand" },
      { label: "Hours + Pay", purpose: "hours plus financing/payment paths" },
    ],
    boundary: "Instagram profile pinning, Highlight ordering/covers, and bio edits remain operator-side actions; this endpoint supplies measured candidates, upload-ready cover assets in the client, and a performance-linked review shelf but does not claim Graph API control that does not exist.",
  };
}

export async function listReusableRealShopMedia(database: DB) {
  const rows = await database.select({
    id: mediaAssets.id,
    logicalKey: mediaAssets.logicalKey,
    runtimeUrl: mediaAssets.runtimeUrl,
    driveUrl: mediaAssets.gdriveViewUrl,
    mimeType: mediaAssets.mimeType,
    width: mediaAssets.width,
    height: mediaAssets.height,
    createdAt: mediaAssets.createdAt,
    generationParamsJson: mediaAssets.generationParamsJson,
  }).from(mediaAssets)
    .where(and(
      eq(mediaAssets.rightsStatus, "real_shop"),
      eq(mediaAssets.isCurrent, 1),
      eq(mediaAssets.reuseAllowed, 1),
      like(mediaAssets.mimeType, "image/%"),
      inArray(mediaAssets.lifecycleState, ["available", "quality_review", "approval_ready", "approved", "published"]),
    ))
    .orderBy(desc(mediaAssets.createdAt))
    .limit(100);
  return rows.flatMap((row) => {
    // Create needs a directly fetchable image URL. A Drive *viewer page* is
    // useful archival metadata but is not a valid <img> source or generation
    // input, so never substitute it for the runtime object URL here.
    const url = row.runtimeUrl;
    if (!url) return [];
    let originalFilename: string | null = null;
    try {
      const meta = row.generationParamsJson ? JSON.parse(row.generationParamsJson) as { originalFilename?: string } : null;
      originalFilename = meta?.originalFilename ?? null;
    } catch {}
    return [{
      id: row.id,
      logicalKey: row.logicalKey,
      url,
      mimeType: row.mimeType,
      width: row.width,
      height: row.height,
      createdAt: row.createdAt,
      originalFilename,
    }];
  });
}
