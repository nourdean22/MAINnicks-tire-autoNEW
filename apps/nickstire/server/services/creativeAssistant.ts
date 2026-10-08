/**
 * Creative Assistant — "what should we make today?" (README §M, PROMPT-PACK §14).
 *
 * Six cards at most, one per type, each with `why` = the exact signal lines
 * it was ranked on. Deterministic: no LLM, every weight is in this file. The
 * score is a product of demand x freshness x evidence, so a strong search
 * query the account covered last week ranks below a weaker one it never
 * touched — fatigue and duplication are multiplicative, not subtractive.
 *
 * THREE STATES PER SOURCE (empty-vs-error skill). Every read is wrapped:
 *   measured  -> `inputs.<source>` is a count (or a short measured summary)
 *   unknown   -> the source answered but could not say (too few posts)
 *   error     -> `inputs.<source> = "error: <message>"` and every card that
 *                depends on that source is OMITTED, never rendered on a zero.
 *
 * IO lives in `defaultReaders`; `composeCreativeCards` is pure and takes the
 * gathered inputs, so the ranking is testable without a database and a test
 * can inject a throwing reader to prove the omission rule.
 */
import { createLogger } from "../lib/logger";
import { DECISION_LOOKS, type ExperimentPresetId } from "../../shared/contentExperiments";
import { MIN_PER_SIDE, measureFindingCosts, type QaOutcomeRow } from "../../shared/renderedQaOutcomes";
import { angleBankLine, type AngleBankSlate, type AngleBankStatus } from "../../shared/angleBank";
import type { RecentReelSignals } from "./reelRepetitionHistory";

const log = createLogger("services:creative-assistant");

export type CreativeCardType = "opportunity" | "capture" | "fatigue" | "quality" | "experiment" | "reuse";
export type CreativeFormat = "reel" | "carousel" | "static" | "article" | "capture" | "experiment";
export type CreativeConfidence = "high" | "medium" | "low";

export interface CreativeCard {
  type: CreativeCardType;
  title: string;
  format: CreativeFormat;
  /** Exact signal lines. "AI recommends" is never one of them. */
  why: string[];
  confidence: CreativeConfidence;
  confidenceReason: string;
  firstAction: string;
  /** The topic to hand Create, when the first action is to make something. */
  topic?: string;
  /** For experiment cards: the preset the first action starts. */
  preset?: ExperimentPresetId;
}

/** Per-source provenance: a count/summary, "unknown", or "error: …". */
export type SourceInput = number | string;

export interface CreativeAssistantResult {
  cards: CreativeCard[];
  generatedAt: string;
  inputs: Record<string, SourceInput>;
}

// ─── Gathered inputs (what the readers return) ────────────────────────────

export interface GscRisingItem {
  query: string;
  impressions?: number | null;
  /** Fractional 7-day change, e.g. 0.38 = +38%. */
  delta7d?: number | null;
  position?: number | null;
}

export interface TopicSignalInputs {
  customerQuestions: string[];
  gscRising: GscRisingItem[];
  declinedWork: string[];
  /** Sub-sources gatherTopicSignals itself reported as failed. */
  failed: string[];
}

export interface PostRecord {
  postId: string;
  postType: string | null;
  caption: string | null;
  reach: number | null;
  saved: number | null;
  shares: number | null;
}

export interface RealAssetInputs {
  count: number;
  assets: Array<{ id: number | string; label: string }>;
  /** From instagramAdminStrategy.captureOpportunities() when that export exists. */
  captures: Array<{ title: string; why: string[]; firstAction?: string }>;
}

export interface ExperimentInputs {
  experimentId: string;
  primaryVariable: string;
  primaryMetric: string;
  arms: number;
  /** Published episodes attached, in the thinnest arm. */
  thinnestArm: number;
  attached: number;
}

/**
 * Shop adoption, measured (2026-10-08): of the pieces actually published in
 * the window, how many carried a REAL shop photo (a reel with a matched
 * `realAsset`, or a photo post whose image was an operator-captured asset)?
 * The capture loop only closes when this number moves; everything upstream of
 * it (capture cards, the real-asset pool) is activity.
 */
export interface RealEvidenceInputs {
  windowDays: number;
  published: number;
  withReal: number;
}

export interface ArticleInputs {
  articles: Array<{ slug: string; title: string; publishDate: string }>;
  social: Array<{ topic: string; hookText: string }>;
}

export type ReadResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface GatheredInputs {
  topicSignals: ReadResult<TopicSignalInputs>;
  ledger: ReadResult<RecentReelSignals>;
  posts: ReadResult<PostRecord[]>;
  realAssets: ReadResult<RealAssetInputs>;
  experiments: ReadResult<ExperimentInputs[]>;
  articles: ReadResult<ArticleInputs>;
  weather: ReadResult<string[]>;
  /** Posted Reels with a completed critic verdict, joined to their latest skip rate (shared/renderedQaOutcomes.ts). */
  qaOutcomes: ReadResult<QaOutcomeRow[]>;
  realEvidence: ReadResult<RealEvidenceInputs>;
  /** The Reels Engine v2 inventory (docs/reels-engine-v2/angle-bank.json) against the packs on disk, the daily rotation and what has published. */
  angleBank: ReadResult<AngleBankStatus>;
}

export interface AssistantReaders {
  topicSignals(): Promise<TopicSignalInputs>;
  ledger(): Promise<RecentReelSignals>;
  posts(): Promise<PostRecord[]>;
  realAssets(): Promise<RealAssetInputs>;
  experiments(): Promise<ExperimentInputs[]>;
  articles(): Promise<ArticleInputs>;
  weather(): Promise<string[]>;
  qaOutcomes(): Promise<QaOutcomeRow[]>;
  realEvidence(): Promise<RealEvidenceInputs>;
  angleBank(): Promise<AngleBankStatus>;
}

async function read<T>(name: string, fn: () => Promise<T>): Promise<ReadResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.warn(`creative assistant source unreadable — cards depending on it are omitted`, { source: name, error });
    return { ok: false, error };
  }
}

// ─── Text matching (deterministic, tiny) ──────────────────────────────────

const STOP = new Set([
  "this", "that", "with", "your", "from", "have", "what", "when", "about", "into", "more", "than",
  "auto", "nick", "nicks", "cleveland", "euclid", "ohio", "does", "should", "there", "their", "they",
  "will", "just", "like", "need", "know", "make", "take", "time", "them", "then", "also", "been",
]);

export function significantWords(s: string | null | undefined): string[] {
  return String(s ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

function overlap(a: string[], b: string[]): number {
  const set = new Set(b);
  return a.filter((w) => set.has(w)).length;
}

/** Two phrases are "the same topic" when they share two significant words,
 *  or one when either phrase only has one. */
function sameTopic(a: string, b: string): boolean {
  const wa = significantWords(a);
  const wb = significantWords(b);
  if (!wa.length || !wb.length) return false;
  const need = Math.min(2, wa.length, wb.length);
  return overlap(wa, wb) >= need;
}

// ─── Pure composition ─────────────────────────────────────────────────────

interface Candidate {
  topic: string;
  demand: number;
  lines: string[];
  sources: Set<string>;
}

const REPETITION_WINDOW_DAYS = 21;
const CAROUSEL_EDGE = 1.3;
const MIN_POSTS_PER_FORMAT = 3;

export interface FormatFit {
  carouselSavesPerReach: number;
  imageSavesPerReach: number;
  ratio: number;
  nCarousel: number;
  nImage: number;
}

/** Carousel vs image saves/reach over the measured posts. null = unknown (too thin). */
export function computeFormatFit(posts: PostRecord[]): FormatFit | null {
  const rates = (type: (t: string) => boolean) => posts
    .filter((p) => p.postType && type(p.postType.toUpperCase()) && p.reach != null && p.reach > 0 && p.saved != null)
    .map((p) => (p.saved as number) / (p.reach as number));
  const carousel = rates((t) => t.includes("CAROUSEL"));
  const image = rates((t) => t === "IMAGE" || t === "FEED" || t === "PHOTO");
  if (carousel.length < MIN_POSTS_PER_FORMAT || image.length < MIN_POSTS_PER_FORMAT) return null;
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const c = mean(carousel);
  const i = mean(image);
  return {
    carouselSavesPerReach: c,
    imageSavesPerReach: i,
    ratio: i > 0 ? c / i : c > 0 ? Infinity : 1,
    nCarousel: carousel.length,
    nImage: image.length,
  };
}

function formatFitLine(fit: FormatFit | null): { format: CreativeFormat; line: string } {
  if (!fit) {
    return { format: "reel", line: `format fit unknown (fewer than ${MIN_POSTS_PER_FORMAT} carousels or images with reach in 90d) — defaulting to reel` };
  }
  const ratio = Number.isFinite(fit.ratio) ? `${fit.ratio.toFixed(1)}x` : "∞";
  if (fit.ratio >= CAROUSEL_EDGE) {
    return { format: "carousel", line: `carousels earn ${ratio} saves/reach vs images (90d, n=${fit.nCarousel}/${fit.nImage})` };
  }
  return { format: "reel", line: `carousels ${ratio} saves/reach vs images (90d, n=${fit.nCarousel}/${fit.nImage}) — no carousel edge, reel` };
}

function collectCandidates(sig: TopicSignalInputs, weather: string[]): Candidate[] {
  const out: Candidate[] = [];
  const add = (topic: string, demand: number, line: string, source: string) => {
    const t = topic.trim();
    if (!t) return;
    const hit = out.find((c) => sameTopic(c.topic, t));
    if (hit) {
      hit.demand += demand;
      hit.lines.push(line);
      hit.sources.add(source);
    } else {
      out.push({ topic: t, demand, lines: [line], sources: new Set([source]) });
    }
  };

  // Customer questions: one mention is one unit of demand; repeats add up.
  const counts = new Map<string, { phrase: string; n: number }>();
  for (const q of sig.customerQuestions) {
    const key = significantWords(q).sort().join(" ") || q.toLowerCase().trim();
    if (!key) continue;
    const cur = counts.get(key) ?? { phrase: q.trim(), n: 0 };
    cur.n += 1;
    counts.set(key, cur);
  }
  for (const { phrase, n } of counts.values()) {
    add(phrase, 1 + n, `${n} customer question${n === 1 ? "" : "s"} (calls/DMs/forms): "${phrase}"`, "customer_questions");
  }

  for (const g of sig.gscRising) {
    const imp = Number(g.impressions ?? 0);
    const delta = g.delta7d == null ? null : Number(g.delta7d);
    const pos = g.position == null ? null : Number(g.position);
    const demand = Math.log10(imp + 1) * (1 + Math.max(0, delta ?? 0));
    const parts = [`GSC "${g.query}" ${imp} impressions`];
    if (delta != null && Number.isFinite(delta)) parts.push(`${delta >= 0 ? "+" : ""}${Math.round(delta * 100)}% 7d`);
    if (pos != null && Number.isFinite(pos)) parts.push(`position ${Math.round(pos)}`);
    add(g.query, demand, parts.join(", "), "gsc_rising");
  }

  sig.declinedWork.forEach((topic, i) => {
    add(topic, Math.max(0.8, 1.5 - i * 0.1), `declined work #${i + 1} by count and dollars upstream: "${topic}"`, "declined_work");
  });

  for (const w of weather) {
    add(w, 0.5, `weather trigger live: ${w}`, "weather");
  }
  return out;
}

function freshness(topic: string, ledger: ReadResult<RecentReelSignals>): { factor: number; line: string; known: boolean } {
  if (!ledger.ok || !ledger.value.available) {
    return { factor: 1, line: "repetition ledger unreadable — freshness unknown", known: false };
  }
  const ages = ledger.value.topicAges
    .filter((t) => sameTopic(t.topic, topic) && Number.isFinite(t.daysAgo))
    .map((t) => t.daysAgo);
  if (!ages.length) return { factor: 1, line: `not covered in the last ${REPETITION_WINDOW_DAYS} days`, known: true };
  const days = Math.min(...ages);
  return { factor: 0.2 + 0.8 * Math.min(1, days / REPETITION_WINDOW_DAYS), line: `last covered ${days} day${days === 1 ? "" : "s"} ago`, known: true };
}

function evidence(topic: string, assets: ReadResult<RealAssetInputs>): { factor: number; line: string; matched: boolean } {
  if (!assets.ok) return { factor: 0.7, line: "real-shop asset pool unreadable — AI visual assumed", matched: false };
  const hit = assets.value.assets.find((a) => sameTopic(a.label, topic));
  if (hit) return { factor: 1, line: `real-shop asset #${hit.id} matches ("${hit.label}")`, matched: true };
  return { factor: 0.7, line: `no real-shop asset matches among ${assets.value.count} reusable — AI visual only`, matched: false };
}

/** "2/14 published pieces in 30d carried real shop evidence" — a zero window says so rather than "0%". */
function realEvidenceLine(r: RealEvidenceInputs): string {
  if (r.published === 0) return `no pieces published in ${r.windowDays}d, so real-evidence share is unmeasured`;
  return `${r.withReal}/${r.published} published pieces in ${r.windowDays}d carried real shop evidence (${Math.round((100 * r.withReal) / r.published)}%)`;
}

export function composeCreativeCards(g: GatheredInputs, now: Date = new Date()): CreativeAssistantResult {
  const cards: CreativeCard[] = [];
  const inputs: Record<string, SourceInput> = {};

  // ── provenance line per source ──
  inputs.topicSignals = g.topicSignals.ok
    ? g.topicSignals.value.customerQuestions.length + g.topicSignals.value.gscRising.length + g.topicSignals.value.declinedWork.length
    : `error: ${g.topicSignals.error}`;
  if (g.topicSignals.ok && g.topicSignals.value.failed.length) {
    inputs.topicSignalsFailed = g.topicSignals.value.failed.join(",");
  }
  inputs.ledger = g.ledger.ok ? (g.ledger.value.available ? g.ledger.value.topics.length : "error: repetition ledger unavailable") : `error: ${g.ledger.error}`;
  const fit = g.posts.ok ? computeFormatFit(g.posts.value) : null;
  inputs.posts = g.posts.ok ? g.posts.value.length : `error: ${g.posts.error}`;
  inputs.formatFit = !g.posts.ok ? `error: ${g.posts.error}` : fit ? `carousel ${Number.isFinite(fit.ratio) ? fit.ratio.toFixed(2) : "inf"}x saves/reach vs image (n=${fit.nCarousel}/${fit.nImage})` : "unknown";
  inputs.realAssets = g.realAssets.ok ? g.realAssets.value.count : `error: ${g.realAssets.error}`;
  inputs.experiments = g.experiments.ok ? g.experiments.value.length : `error: ${g.experiments.error}`;
  inputs.articles = g.articles.ok ? g.articles.value.articles.length : `error: ${g.articles.error}`;
  inputs.weather = g.weather.ok ? g.weather.value.length : `error: ${g.weather.error}`;
  inputs.qaOutcomes = g.qaOutcomes.ok ? g.qaOutcomes.value.filter((r) => r.skipRate != null).length : `error: ${g.qaOutcomes.error}`;
  const evidenceLine = g.realEvidence.ok ? realEvidenceLine(g.realEvidence.value) : null;
  inputs.realEvidence = evidenceLine ?? `error: ${(g.realEvidence as { error: string }).error}`;
  // The inventory's state is a provenance line, not a card: "<N> production-ready
  // angles of <M>: <x> with a pack, <y> in rotation, <z> published; awaiting
  // rotation approval: …". A zero is printed as a zero; an unreadable bank or
  // rotation is an error input (UNKNOWN), never a quiet "all in rotation".
  inputs.angleBank = g.angleBank.ok ? angleBankLine(g.angleBank.value) : `error: ${g.angleBank.error}`;

  // ── 1. opportunity ──
  let opportunity: { topic: string; assetMatched: boolean } | null = null;
  if (g.topicSignals.ok) {
    const weather = g.weather.ok ? g.weather.value : [];
    const scored = collectCandidates(g.topicSignals.value, weather).map((c) => {
      const f = freshness(c.topic, g.ledger);
      const e = evidence(c.topic, g.realAssets);
      return { c, f, e, score: c.demand * f.factor * e.factor };
    }).sort((a, b) => b.score - a.score || a.c.topic.localeCompare(b.c.topic));
    const top = scored[0];
    if (top) {
      const { format, line: fitLine } = formatFitLine(fit);
      const sources = top.c.sources.size;
      const onlyRankedSource = [...top.c.sources].every((s) => s === "declined_work" || s === "weather");
      let confidence: CreativeConfidence;
      let confidenceReason: string;
      if (!top.f.known) {
        confidence = "low";
        confidenceReason = "repetition ledger unreadable — this may be a repeat";
      } else if (sources >= 2 && top.f.factor >= 0.8) {
        confidence = "high";
        confidenceReason = `${sources} independent demand sources and not covered recently`;
      } else if (onlyRankedSource) {
        confidence = "low";
        confidenceReason = "demand is a rank, not a count (declined-work counts never leave the ranker)";
      } else {
        confidence = "medium";
        confidenceReason = sources >= 2 ? "two sources but covered recently" : "one demand source";
      }
      // A sub-source gatherTopicSignals could not read (declined_work, the
      // customer-language miner, GSC) leaves the ranking incomplete: say so on
      // the card and never call it high-confidence.
      const failedSub = g.topicSignals.value.failed;
      if (failedSub.length && confidence === "high") {
        confidence = "medium";
        confidenceReason += `; ${failedSub.join(", ")} unreadable, ranking incomplete`;
      }
      opportunity = { topic: top.c.topic, assetMatched: top.e.matched };
      cards.push({
        type: "opportunity",
        title: top.c.topic,
        format,
        why: [
          ...top.c.lines, top.f.line, top.e.line, fitLine,
          `score ${top.score.toFixed(2)} = demand ${top.c.demand.toFixed(2)} x freshness ${top.f.factor.toFixed(2)} x evidence ${top.e.factor.toFixed(2)}`,
          ...(failedSub.length ? [`signal sources unreadable: ${failedSub.join(", ")} — ranking incomplete`] : []),
        ],
        confidence,
        confidenceReason,
        firstAction: `Open Create as a ${format}: "${top.c.topic}"`,
        topic: top.c.topic,
      });
    }
  }

  // ── 2. capture ──
  if (g.realAssets.ok) {
    const captured = g.realAssets.value.captures[0];
    if (captured) {
      cards.push({
        type: "capture",
        title: captured.title,
        format: "capture",
        why: [...(captured.why.length ? captured.why : [`real-shop pool: ${g.realAssets.value.count} reusable images`]), ...(evidenceLine ? [evidenceLine] : [])],
        confidence: "medium",
        confidenceReason: "capture opportunities come from the asset enrichment pass, not from outcomes",
        firstAction: captured.firstAction ?? "Shoot it on the next matching job",
      });
    } else if (opportunity && !opportunity.assetMatched) {
      cards.push({
        type: "capture",
        title: `Shoot real-shop photos: ${opportunity.topic}`,
        format: "capture",
        why: [
          `top opportunity "${opportunity.topic}" has no matching real-shop asset`,
          `real-shop pool: ${g.realAssets.value.count} reusable images`,
          ...(evidenceLine ? [evidenceLine] : []),
        ],
        confidence: g.realAssets.value.count === 0 ? "high" : "medium",
        confidenceReason: g.realAssets.value.count === 0 ? "the pool is empty — nothing real can be reused" : "no word match in the pool; a near match may exist under another name",
        // The six-shot set from docs/reels-engine-v2/05-CAPTURE-CHECKLIST.md. The
        // pool the lane reads is image-only (listReusableRealShopMedia filters
        // image/%), so a still of each shot is what unblocks a Reel today; the
        // clip is for the lanes that come after the production proof.
        firstAction: `Shoot the six-shot set for ${opportunity.topic} on the next job — context, defect macro, measurement, hands on the part, corrected part, matched final (vertical; a still of each, plus a 5–8 s clip when easy)`,
        topic: opportunity.topic,
      });
    }
  }

  // ── 3. fatigue ──
  if (g.ledger.ok && g.ledger.value.available) {
    const L = g.ledger.value;
    const dims: Array<[string, string[]]> = [
      ["topic", L.topics.map((t) => t.toLowerCase().trim())],
      ["hook grammar", L.hookGrammars],
      ["structure", L.structurePatternIds],
      ["CTA family", L.ctaFamilies],
      ["archetype", L.archetypes],
      ["motion lens", L.motionLenses],
      ["object character", L.objectCharacters],
    ];
    const repeats: Array<{ dim: string; value: string; n: number }> = [];
    for (const [dim, values] of dims) {
      const counts = new Map<string, number>();
      for (const v of values) if (v && v !== "unknown") counts.set(v, (counts.get(v) ?? 0) + 1);
      for (const [value, n] of counts) if (n >= 3) repeats.push({ dim, value, n });
    }
    repeats.sort((a, b) => b.n - a.n || a.dim.localeCompare(b.dim) || a.value.localeCompare(b.value));
    const top = repeats[0];
    if (top) {
      cards.push({
        type: "fatigue",
        title: `${top.dim} "${top.value}" used ${top.n}x in ${REPETITION_WINDOW_DAYS} days`,
        format: "reel",
        why: repeats.slice(0, 4).map((r) => `${r.dim} "${r.value}" used ${r.n}x in ${REPETITION_WINDOW_DAYS} days (${L.topics.length} reel jobs in window)`),
        confidence: "high",
        confidenceReason: "a count over the reel_jobs ledger, not an estimate",
        firstAction: `Exclude ${top.dim} "${top.value}" from the next brief`,
      });
    }
  }

  // ── 3b. quality: a critic finding the audience has priced ──
  //
  // The rendered-QA registry decides by taste which defects ship as warnings.
  // This card appears only when the posts carrying one code are skipped more
  // than the posts without it by a margin a permutation test, corrected for
  // the number of codes tested, would rarely produce (shared/renderedQaOutcomes).
  // A read failure omits the card; too few posts per side is "not tested" and
  // also omits it — the critic's taste is not contradicted by silence.
  if (g.qaOutcomes.ok) {
    const costs = measureFindingCosts(g.qaOutcomes.value);
    const costly = costs.filter((c) => c.costly);
    const top = costly[0];
    if (top) {
      cards.push({
        type: "quality",
        title: `Critic finding "${top.code}" costs viewers`,
        format: "reel",
        why: [
          ...costly.slice(0, 3).map((c) =>
            `${c.code}: ${c.withN} posts with it skip ${c.withMeanSkip.toFixed(1)}% vs ${c.withoutMeanSkip.toFixed(1)}% for ${c.withoutN} without (+${c.deltaPoints.toFixed(1)} pts, p=${c.p.toFixed(3)} <= ${c.alpha.toFixed(4)})`),
          `latest skip-rate snapshot per posted Reel; ${costs.length} code(s) had >= ${MIN_PER_SIDE} posts on both sides and were tested`,
        ],
        confidence: "high",
        confidenceReason: "a measured skip-rate gap on the account's own posts, not the critic's opinion of the frame",
        firstAction: `Make ${top.code} a repair, not a warning, in the rendered-QA registry`,
      });
    }
  }

  // ── 4. experiment ──
  if (g.experiments.ok) {
    // The resolver's first possible verdict is the first planned look
    // (DECISION_LOOKS[0] per arm), not the 4-post floor; the card counts to
    // the number that can actually produce a result.
    const firstLook = DECISION_LOOKS[0];
    const thin = g.experiments.value.find((e) => e.thinnestArm < firstLook);
    if (thin) {
      cards.push({
        type: "experiment",
        title: `Experiment running: ${thin.experimentId}`,
        format: "experiment",
        why: [
          `${thin.attached} published episode${thin.attached === 1 ? "" : "s"} attached across ${thin.arms} arms; thinnest arm ${thin.thinnestArm}/${firstLook} needed for the first verdict`,
          `primary metric ${thin.primaryMetric} on ${thin.primaryVariable}`,
        ],
        confidence: "high",
        confidenceReason: "counts from content_experiment_assignments",
        firstAction: `Keep the lane posting — ${firstLook - thin.thinnestArm} more in the thinnest arm before the resolver's first look`,
      });
    } else if (g.experiments.value.length === 0 && g.ledger.ok && g.ledger.value.available) {
      const buckets = g.ledger.value.durationBuckets;
      const distinct = new Set(buckets);
      if (buckets.length >= 3 && distinct.size === 1) {
        const bucket = [...distinct][0];
        cards.push({
          type: "experiment",
          title: "Start duration_v1",
          format: "experiment",
          why: [
            `${buckets.length} recent reel jobs all declared ~${bucket}`,
            "no content experiment is running",
            "primary metric: sends/reach (3-s skip and watch/duration are not gatherable by the resolver yet)",
          ],
          confidence: "medium",
          confidenceReason: "declared storyboard length, not rendered length; the 45-60s lane is capped at the 35s storyboard ceiling",
          firstAction: "content.startContentExperiment({ preset: \"duration_v1\" })",
          preset: "duration_v1",
        });
      }
    }
  }

  // ── 5. reuse ──
  if (g.articles.ok) {
    const { articles, social } = g.articles.value;
    const orphan = articles.find((a) => !social.some((s) => sameTopic(`${s.topic} ${s.hookText}`, `${a.title} ${a.slug.replace(/-/g, " ")}`)));
    if (orphan) {
      cards.push({
        type: "reuse",
        title: `Article "${orphan.title}" has no social derivative`,
        format: "carousel",
        why: [
          `published ${orphan.publishDate} (/${orphan.slug})`,
          `no social_content_inventory row shares its title/slug words in 60 days (${social.length} rows checked)`,
        ],
        confidence: "medium",
        confidenceReason: "word overlap between inventory topic/hook and the article title — a paraphrased derivative would not match",
        firstAction: `Open Create as a carousel from the article "${orphan.title}"`,
        topic: orphan.title,
      });
    } else if (g.posts.ok) {
      const winner = g.posts.value
        .filter((p) => p.shares != null && p.shares > 0 && p.caption)
        .sort((a, b) => (b.shares as number) - (a.shares as number))
        .find((p) => !articles.some((a) => sameTopic(a.title, (p.caption as string).slice(0, 160))));
      if (winner) {
        cards.push({
          type: "reuse",
          title: `Top-shares post has no article`,
          format: "article",
          why: [
            `post ${winner.postId}: ${winner.shares} shares / ${winner.reach ?? "unknown"} reach (latest 90d snapshot)`,
            `no published article shares its caption's words (${articles.length} checked)`,
          ],
          confidence: "medium",
          confidenceReason: "caption-to-title word overlap only",
          firstAction: `Draft an article from the caption of post ${winner.postId}`,
          topic: (winner.caption as string).slice(0, 120),
        });
      }
    }
  }

  return { cards: cards.slice(0, 6), generatedAt: now.toISOString(), inputs };
}

// ─── IO readers ───────────────────────────────────────────────────────────

const NINETY_DAYS_MS = 90 * 86_400_000;
const SIXTY_DAYS_MS = 60 * 86_400_000;

const defaultReaders: AssistantReaders = {
  async topicSignals() {
    const { gatherTopicSignals } = await import("./contentTopicSignals");
    const report = await gatherTopicSignals();
    // customerQuestions / gscRising landed in TopicSignals alongside this
    // change (contentTopicMiner.GscRisingSignal carries an ABSOLUTE
    // deltaImpressions); both stay optional, so an older signal set still
    // reports 0 (measured) rather than failing.
    const s = report.signals;
    return {
      customerQuestions: s.customerQuestions ?? [],
      gscRising: (s.gscRising ?? []).map((g) => {
        const previous = g.impressions - g.deltaImpressions;
        return {
          query: g.query,
          impressions: g.impressions,
          delta7d: previous > 0 ? g.deltaImpressions / previous : null,
          position: g.position,
        };
      }),
      declinedWork: s.declinedWork ?? [],
      failed: report.failed,
    };
  },
  async ledger() {
    const { getRecentReelSignals } = await import("./reelRepetitionHistory");
    return getRecentReelSignals();
  },
  async posts() {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) throw new Error("no database");
    const { igMetricSnapshots, instagramAnalytics } = await import("../../drizzle/schema");
    const { and, desc, gte, inArray, sql } = await import("drizzle-orm");
    const since = new Date(Date.now() - NINETY_DAYS_MS);
    const snaps = await d
      .select({ postId: igMetricSnapshots.postId, reach: igMetricSnapshots.reach, saved: igMetricSnapshots.saved, shares: igMetricSnapshots.shares })
      .from(igMetricSnapshots)
      // Instagram rows only: the FB insights lane writes `fb:<id>` rows into
      // this table (instagram-data.ts FB_SNAPSHOT_PREFIX) and they must not
      // join an IG format-fit ratio.
      .where(and(gte(igMetricSnapshots.capturedAt, since), sql`${igMetricSnapshots.postId} NOT LIKE 'fb:%'`))
      .orderBy(desc(igMetricSnapshots.capturedAt))
      .limit(3000);
    const latest = new Map<string, { reach: number | null; saved: number | null; shares: number | null }>();
    for (const s of snaps) if (!latest.has(s.postId)) latest.set(s.postId, { reach: s.reach, saved: s.saved, shares: s.shares });
    const ids = [...latest.keys()];
    const meta = new Map<string, { postType: string | null; caption: string | null }>();
    if (ids.length) {
      const rows = await d
        .select({ postId: instagramAnalytics.postId, postType: instagramAnalytics.postType, caption: instagramAnalytics.caption })
        .from(instagramAnalytics)
        .where(inArray(instagramAnalytics.postId, ids.slice(0, 500)));
      for (const r of rows) if (!meta.has(r.postId)) meta.set(r.postId, { postType: r.postType, caption: r.caption });
    }
    return ids.map((postId) => ({ postId, ...latest.get(postId)!, postType: meta.get(postId)?.postType ?? null, caption: meta.get(postId)?.caption ?? null }));
  },
  async realAssets() {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) throw new Error("no database");
    const { captureOpportunities, listReusableRealShopMedia } = await import("./instagramAdminStrategy");
    type DB = Parameters<typeof listReusableRealShopMedia>[0];
    const pool = await listReusableRealShopMedia(d as DB);
    const assets = pool.map((a) => ({ id: a.id, label: `${a.logicalKey} ${a.originalFilename ?? ""}`.trim() }));
    // §K.4 capture opportunities (instagramAdminStrategy): subjects the slate
    // needs a real photo of and the enriched pool cannot supply. Throws on a
    // pool-read failure, which the wrapper turns into an error input.
    // The sibling's return shape has moved between `CaptureOpportunity[]` and
    // `{ opportunities: CaptureOpportunity[] }` during this wave; accept both
    // so a shape change there cannot silently empty this card.
    const raw: unknown = await captureOpportunities(d as DB);
    const list: unknown[] = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { opportunities?: unknown[] } | null)?.opportunities)
        ? ((raw as { opportunities: unknown[] }).opportunities)
        : [];
    const captures = list.flatMap((item) => {
      const c = item as { subject?: unknown; forTopic?: unknown; why?: unknown };
      const subject = typeof c.subject === "string" ? c.subject.trim() : "";
      if (!subject) return [];
      const why = Array.isArray(c.why) ? c.why.map(String) : [];
      return [{
        title: `Capture: ${subject}`,
        why: [...(typeof c.forTopic === "string" ? [`needed for "${c.forTopic}"`] : []), ...why],
        firstAction: `Shoot the six-shot set for ${subject} on the next matching job — context, defect macro, measurement, hands on the part, corrected part, matched final (vertical; a still of each, plus a 5–8 s clip when easy)`,
      }];
    });
    return { count: assets.length, assets, captures };
  },
  async experiments() {
    const { loadRunningExperiments } = await import("./contentExperimentStore");
    const running = await loadRunningExperiments();
    if (!running.length) return [];
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) throw new Error("no database");
    const { contentExperimentAssignments } = await import("../../drizzle/schema");
    const { isNotNull, sql } = await import("drizzle-orm");
    const counts = await d
      .select({ experimentId: contentExperimentAssignments.experimentId, armId: contentExperimentAssignments.armId, n: sql<number>`count(*)` })
      .from(contentExperimentAssignments)
      .where(isNotNull(contentExperimentAssignments.mediaId))
      .groupBy(contentExperimentAssignments.experimentId, contentExperimentAssignments.armId);
    return running.map((def) => {
      const perArm = def.arms.map((a) => Number((counts as Array<{ experimentId: string; armId: string; n: number }>).find((c) => c.experimentId === def.experimentId && c.armId === a.armId)?.n ?? 0));
      return {
        experimentId: def.experimentId,
        primaryVariable: def.primaryVariable,
        primaryMetric: def.primaryMetric,
        arms: def.arms.length,
        thinnestArm: perArm.length ? Math.min(...perArm) : 0,
        attached: perArm.reduce((s, n) => s + n, 0),
      };
    });
  },
  async articles() {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) throw new Error("no database");
    const { dynamicArticles, socialContentInventory } = await import("../../drizzle/schema");
    const { desc, eq, gte } = await import("drizzle-orm");
    const [articles, social] = await Promise.all([
      d.select({ slug: dynamicArticles.slug, title: dynamicArticles.title, publishDate: dynamicArticles.publishDate })
        .from(dynamicArticles)
        .where(eq(dynamicArticles.status, "published"))
        .orderBy(desc(dynamicArticles.createdAt))
        .limit(60),
      d.select({ topic: socialContentInventory.topic, hookText: socialContentInventory.hookText })
        .from(socialContentInventory)
        .where(gte(socialContentInventory.createdAt, new Date(Date.now() - SIXTY_DAYS_MS)))
        .limit(400),
    ]);
    return { articles, social };
  },
  async weather() {
    const { evaluateWeatherTriggers } = await import("./weatherIntelligence");
    return (await evaluateWeatherTriggers()).triggered;
  },
  async realEvidence() {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) throw new Error("no database");
    const { igAutopostLog, reelJobs } = await import("../../drizzle/schema");
    const { and, desc, eq, gte } = await import("drizzle-orm");
    const { parseReelJobPayload } = await import("../../shared/reelJobPayload");
    const windowDays = 30;
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const [reels, photos] = await Promise.all([
      // "posted" only, on purpose: reel_jobs has no publication timestamp, and the
      // paths that write "published" (reconcileAssembledReel, reconciliation)
      // stamp updatedAt = now, which would pull an old reel into this window.
      d.select({ payload: reelJobs.payload }).from(reelJobs)
        .where(and(eq(reelJobs.status, "posted"), gte(reelJobs.updatedAt, since)))
        .orderBy(desc(reelJobs.updatedAt)).limit(200),
      d.select({ scores: igAutopostLog.evalScoresJson }).from(igAutopostLog)
        .where(and(eq(igAutopostLog.status, "posted"), gte(igAutopostLog.createdAt, since)))
        .orderBy(desc(igAutopostLog.createdAt)).limit(200),
    ]);
    let withReal = 0;
    for (const r of reels as Array<{ payload: string | null }>) {
      if (parseReelJobPayload(r.payload).realAsset?.assetId) withReal++;
    }
    for (const p of photos as Array<{ scores: string | null }>) {
      // igAutopost records a real-asset image as `image.note = "real shop
      // asset <id> — operator-captured photo, eval skipped"` (igAutopost.ts,
      // the eval branch); nothing else writes that prefix.
      try {
        const note = (JSON.parse(p.scores ?? "{}") as { image?: { note?: unknown } }).image?.note;
        if (typeof note === "string" && note.startsWith("real shop asset ")) withReal++;
      } catch {
        // an unreadable score row is not evidence either way
      }
    }
    return { windowDays, published: reels.length + photos.length, withReal };
  },
  async angleBank() {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { resolvePacksDir } = await import("./reelPackRegistry");
    const { APPROVED_REEL_PACK_SLUGS, packBuildsForLane, readActiveReelSlate } = await import("./approvedReelPackRotation");
    const { PRODUCTION_READY_COUNT, angleBankStatus, parseAngleBank } = await import("../../shared/angleBank");
    const packsDir = resolvePacksDir();
    if (!packsDir) throw new Error("no reel-packs directory in this process");
    // The bank lives beside the packs it indexes; a missing or malformed file
    // throws (parseAngleBank names the first defect) and becomes an error input.
    const bank = parseAngleBank(JSON.parse(fs.readFileSync(path.join(packsDir, "..", "reels-engine-v2", "angle-bank.json"), "utf8")));
    // Usable = the production builder accepts it (the lane's own instrument);
    // a missing or rejected pack is reported by angleBankStatus as BROKEN, not thrown.
    const buildablePacks = new Set<string>();
    for (const a of bank.angles.slice(0, PRODUCTION_READY_COUNT)) {
      if (a.packSlug && packBuildsForLane(a.packSlug)) buildablePacks.add(a.packSlug);
    }
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) throw new Error("no database");
    const { reelJobs } = await import("../../drizzle/schema");
    const { desc, inArray } = await import("drizzle-orm");
    const { parseReelJobPayload } = await import("../../shared/reelJobPayload");
    // Both spellings are terminal live states: dailyReelPost writes "posted" and
    // reconciliation may promote the same media to "published" (reelReliability.ts).
    // No time window here, so the reconciliation timestamp cannot skew it.
    const posted = await d.select({ payload: reelJobs.payload }).from(reelJobs)
      .where(inArray(reelJobs.status, ["posted", "published"])).orderBy(desc(reelJobs.updatedAt)).limit(500);
    const publishedPackSlugs = new Set<string>();
    for (const r of posted as Array<{ payload: string | null }>) {
      const slug = parseReelJobPayload(r.payload).approvedPackSlug;
      if (typeof slug === "string" && slug) publishedPackSlugs.add(slug);
    }
    // While an operator slate is set the lane draws only from it
    // (resolveApprovedPackSelection); the drain holds on an unreadable slate and
    // on one whose cursor has passed its last pack (dailyReelPost.ts).
    const slate = await readActiveReelSlate(d);
    const activeSlate: AngleBankSlate | null = slate.malformed
      ? { slugs: new Set<string>(), state: "unreadable" }
      : slate.configured
        ? { slugs: new Set<string>(slate.slugs), state: (slate.cursor ?? 0) >= slate.slugs.length ? "exhausted" : "active" }
        : null;
    return angleBankStatus(bank, { buildablePacks, rotation: new Set<string>(APPROVED_REEL_PACK_SLUGS), activeSlate, publishedPackSlugs });
  },
  async qaOutcomes() {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) throw new Error("no database");
    const { igMetricSnapshots, reelJobs } = await import("../../drizzle/schema");
    const { and, desc, eq, gte, inArray, isNotNull } = await import("drizzle-orm");
    const { parseReelJobPayload } = await import("../../shared/reelJobPayload");
    const since = new Date(Date.now() - NINETY_DAYS_MS);
    const jobs = await d
      .select({ igPostId: reelJobs.igPostId, payload: reelJobs.payload })
      .from(reelJobs)
      // "posted" only: a "published" row's updatedAt is its reconciliation time,
      // not its publication time, so it cannot be windowed (see realEvidence).
      .where(and(eq(reelJobs.status, "posted"), isNotNull(reelJobs.igPostId), gte(reelJobs.updatedAt, since)))
      .orderBy(desc(reelJobs.updatedAt))
      .limit(200);
    const rows = new Map<string, QaOutcomeRow>();
    for (const job of jobs as Array<{ igPostId: string | null; payload: string | null }>) {
      if (!job.igPostId || rows.has(job.igPostId)) continue;
      const qa = parseReelJobPayload(job.payload).renderedQa;
      // Only a COMPLETED verdict that still describes the posted mp4 is a
      // reading of that Reel. An unavailable critic says nothing about the
      // frames; a verdict made stale by a repair describes a file nobody saw.
      if (!qa || qa.qaState !== "completed" || qa.staleAfterRepair) continue;
      rows.set(job.igPostId, { postId: job.igPostId, codes: [...new Set(qa.findings.map((f) => String(f.code)))], skipRate: null });
    }
    const ids = [...rows.keys()];
    if (!ids.length) return [];
    // Latest NON-NULL reading per post. instagram-data refreshes insights only
    // for posts under 14 days old but keeps writing a snapshot row (skip_rate
    // NULL) for every recent media item, so "newest row" would drop a Reel the
    // moment it aged past 14 days although its real skip rate is one row older.
    const snaps = await d
      .select({ postId: igMetricSnapshots.postId, skipRate: igMetricSnapshots.skipRate })
      .from(igMetricSnapshots)
      .where(and(inArray(igMetricSnapshots.postId, ids.slice(0, 500)), isNotNull(igMetricSnapshots.skipRate)))
      .orderBy(desc(igMetricSnapshots.capturedAt))
      .limit(3000);
    const seen = new Set<string>();
    for (const s of snaps as Array<{ postId: string; skipRate: unknown }>) {
      if (seen.has(s.postId)) continue; // newest first: the first row per post is its latest non-null reading
      seen.add(s.postId);
      // DECIMAL arrives as a string from mysql2 ("83.6000"); a null stays null.
      const n = s.skipRate == null ? null : Number(s.skipRate);
      const r = rows.get(s.postId);
      if (r) r.skipRate = n != null && Number.isFinite(n) ? n : null;
    }
    return [...rows.values()];
  },
};

async function gatherCreativeInputs(readers: AssistantReaders = defaultReaders): Promise<GatheredInputs> {
  const [topicSignals, ledger, posts, realAssets, experiments, articles, weather, qaOutcomes, realEvidence, angleBank] = await Promise.all([
    read("topicSignals", readers.topicSignals),
    read("ledger", readers.ledger),
    read("posts", readers.posts),
    read("realAssets", readers.realAssets),
    read("experiments", readers.experiments),
    read("articles", readers.articles),
    read("weather", readers.weather),
    read("qaOutcomes", readers.qaOutcomes),
    read("realEvidence", readers.realEvidence),
    read("angleBank", readers.angleBank),
  ]);
  return { topicSignals, ledger, posts, realAssets, experiments, articles, weather, qaOutcomes, realEvidence, angleBank };
}

/** The router's entry point: gather every source, then rank. */
export async function buildCreativeAssistant(readers: AssistantReaders = defaultReaders, now: Date = new Date()): Promise<CreativeAssistantResult> {
  return composeCreativeCards(await gatherCreativeInputs(readers), now);
}
