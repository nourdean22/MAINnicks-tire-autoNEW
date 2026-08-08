/**
 * Content topic miner — turns available signals into RANKED episode candidates.
 *
 * Pure by design: every function here takes already-fetched signals and returns
 * candidates. No network, no DB. That makes the ranking testable, and it keeps
 * the honest-sourcing rules (below) enforceable rather than aspirational.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS DELIBERATELY DOES NOT DO: auto-mine NHTSA and Ohio E-Check.
 *
 * Those are the two feeds every content plan reaches for first. This repo has
 * already established they are unreachable: `evidenceRecords.ts` carries
 * `snapshotStatus: "fetch_blocked"` precisely because the URL truth audit
 * proved NHTSA and Ohio EPA block fetchers. A miner that silently emits
 * recall candidates it cannot source would manufacture exactly the confident
 * unsourced claim the truth gate exists to stop.
 *
 * So `government_source` topics are emitted as candidates with
 * `blockedReason` set — visible in the queue, ranked, and NOT renderable until
 * an operator attaches evidence by hand. Surfacing a blocked opportunity is
 * useful. Pretending it is ready is not.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * GENERATE MANY, RENDER FEW. Generation is cheap and rendering is not, so the
 * miner is tuned to over-produce and the ranking does the discarding. Bulk
 * publishing because candidates are plentiful is the failure mode this shape
 * is meant to prevent.
 */
import { FRANCHISES, FRANCHISE_IDS, type FranchiseId, type EvidenceRequirement } from "./contentFranchises";

export const TOPIC_MINER_VERSION = "content-topic-miner-v1" as const;

/** Where a candidate came from. Ordered loosely by how much we trust it. */
export type TopicSource =
  | "declined_work"
  | "performance_signal"
  | "verified_review_theme"
  | "customer_question"
  | "seasonal_condition"
  | "coverage_gap"
  | "government_feed";

export interface TopicSignals {
  /** Themes from posts that actually performed. */
  topThemes?: string[];
  /** Recurring subjects in verified reviews. */
  reviewThemes?: string[];
  /** What customers actually ask, from calls/DMs/forms. */
  customerQuestions?: string[];
  /** Current local condition worth talking about (e.g. "first hard freeze"). */
  seasonalConditions?: string[];
  /** Service categories with little or no recent content. */
  underCoveredServices?: string[];
  /** Topics already used recently — candidates matching these are suppressed. */
  recentTopics?: string[];
  /** Franchises used recently, newest first. Drives rotation. */
  recentFranchises?: FranchiseId[];
  /**
   * Repairs customers were QUOTED and REFUSED, best-first, already phrased as
   * briefs by shared/declinedWorkTopics. Carries no counts or dollars — those
   * rank upstream and stay out of anything a generator sees.
   */
  declinedWork?: string[];
}

export interface TopicCandidate {
  topic: string;
  source: TopicSource;
  franchiseId: FranchiseId;
  requiredEvidence: readonly EvidenceRequirement[];
  score: number;
  reasons: string[];
  /** Set when the candidate CANNOT be rendered autonomously — surfaced anyway. */
  blockedReason?: string;
}

/** Base weight per source. Performance and verified reviews outrank guesses. */
const SOURCE_WEIGHT: Record<TopicSource, number> = {
  // Highest weight in the table, deliberately. Every other source is a proxy
  // for what a customer might care about; this one is a customer who stood at
  // the counter, heard a price, and said no. It is also the only source that is
  // un-generic BY CONSTRUCTION — no other shop has this list — which is the bar
  // HARD_REJECT_RULES[0] sets and 36% of published posts currently fail.
  declined_work: 34,
  performance_signal: 30,
  verified_review_theme: 28,
  customer_question: 26,
  seasonal_condition: 22,
  coverage_gap: 16,
  government_feed: 20,
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Overlap check that tolerates rewording — exact-match dedup lets the same
 *  idea back in wearing different words, which is how a feed gets repetitive
 *  while every row looks unique. */
export function isNearDuplicate(candidate: string, priors: string[]): boolean {
  const a = new Set(norm(candidate).split(" ").filter((w) => w.length > 3));
  if (a.size === 0) return false;
  for (const p of priors) {
    const b = new Set(norm(p).split(" ").filter((w) => w.length > 3));
    if (b.size === 0) continue;
    let shared = 0;
    for (const w of a) if (b.has(w)) shared++;
    if (shared / Math.min(a.size, b.size) >= 0.6) return true;
  }
  return false;
}

/**
 * Franchise rotation: a franchise used recently is penalised so the page does
 * not become one show. The penalty decays with distance, so a franchise from
 * eight episodes ago is effectively free again.
 */
export function rotationPenalty(f: FranchiseId, recent: FranchiseId[]): number {
  const idx = recent.indexOf(f);
  if (idx === -1) return 0;
  return Math.max(0, 12 - idx * 2);
}

/** Pick the franchise whose evidence needs and objective best fit a source. */
export function franchiseForSource(source: TopicSource, recent: FranchiseId[]): FranchiseId {
  const prefer: Record<TopicSource, FranchiseId[]> = {
    // A refused repair is a diagnosis story and a price objection, which is what
    // these three shows are for.
    declined_work: ["can_it_be_saved", "mechanic_myth_lab", "pothole_court"],
    performance_signal: ["dashboard_after_dark", "pothole_court", "tire_autopsy"],
    verified_review_theme: ["review_reconstructed"],
    customer_question: ["can_it_be_saved", "mechanic_myth_lab", "dashboard_after_dark"],
    seasonal_condition: ["cleveland_car_survival", "rust_files"],
    coverage_gap: ["tire_autopsy", "choose_the_ending", "can_it_be_saved"],
    government_feed: ["recall_radar", "echeck_escape_room"],
  };
  const options = prefer[source];
  // Lowest rotation penalty wins; ties keep the declared preference order.
  return options.reduce((best, f) =>
    rotationPenalty(f, recent) < rotationPenalty(best, recent) ? f : best,
  );
}

export function mineTopicCandidates(signals: TopicSignals): TopicCandidate[] {
  const recentTopics = signals.recentTopics ?? [];
  const recentFranchises = signals.recentFranchises ?? [];
  const out: TopicCandidate[] = [];

  const add = (topic: string, source: TopicSource) => {
    if (!topic.trim()) return;
    if (isNearDuplicate(topic, recentTopics)) return;
    const franchiseId = franchiseForSource(source, recentFranchises);
    const franchise = FRANCHISES[franchiseId];
    const reasons = [`source: ${source}`, `franchise: ${franchise.name}`];
    let score = SOURCE_WEIGHT[source];

    const penalty = rotationPenalty(franchiseId, recentFranchises);
    if (penalty > 0) {
      score -= penalty;
      reasons.push(`rotation penalty -${penalty} (used ${recentFranchises.indexOf(franchiseId) + 1} episodes ago)`);
    }

    // A franchise needing government evidence cannot be rendered autonomously:
    // the sources are fetch-blocked, so evidence must be attached by hand.
    const needsGov = franchise.requiredEvidence.includes("government_source");
    const blockedReason = needsGov
      ? "requires government_source evidence — NHTSA/Ohio E-Check block automated fetching, so an operator must attach the record before render"
      : undefined;
    if (blockedReason) reasons.push("surfaced but NOT auto-renderable");

    out.push({
      topic: topic.trim(),
      source,
      franchiseId,
      requiredEvidence: franchise.requiredEvidence,
      score,
      reasons,
      blockedReason,
    });
  };

  // First, so that when two sources name the same subject the within-run dedup
  // below keeps the declined-work phrasing — it is the one with a real customer
  // objection behind it.
  for (const t of signals.declinedWork ?? []) add(t, "declined_work");
  for (const t of signals.topThemes ?? []) add(t, "performance_signal");
  for (const t of signals.reviewThemes ?? []) add(t, "verified_review_theme");
  for (const t of signals.customerQuestions ?? []) add(t, "customer_question");
  for (const t of signals.seasonalConditions ?? []) add(t, "seasonal_condition");
  for (const t of signals.underCoveredServices ?? []) add(t, "coverage_gap");

  // Suppress duplicates WITHIN this run too, keeping the higher-scoring one —
  // two sources naming the same subject is common and should not double-spend.
  const kept: TopicCandidate[] = [];
  for (const c of out.sort((a, b) => b.score - a.score)) {
    if (!isNearDuplicate(c.topic, kept.map((k) => k.topic))) kept.push(c);
  }
  return kept;
}

/** Candidates safe to render without an operator attaching evidence first. */
export function autoRenderable(candidates: TopicCandidate[]): TopicCandidate[] {
  return candidates.filter((c) => !c.blockedReason);
}

/** Franchises with no candidate this round — the coverage report. */
export function uncoveredFranchises(candidates: TopicCandidate[]): FranchiseId[] {
  const used = new Set(candidates.map((c) => c.franchiseId));
  return FRANCHISE_IDS.filter((f) => !used.has(f));
}
