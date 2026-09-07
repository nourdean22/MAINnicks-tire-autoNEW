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
  | "government_feed"
  | "local_discovery";

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
  /**
   * Curated local-topic seed prompts for a cold start, from
   * shared/localDiscoveryLibrary.ts (NT-014) — tire_symptom + weather_road
   * categories only. E-Check topics go through governmentFeedTopics instead
   * (below), NOT here, so they still route to the franchise that requires
   * government_source evidence rather than bypassing that gate.
   */
  localDiscoveryTopics?: string[];
  /**
   * Government-sourced topic prompts (e.g. the e_check category of
   * localDiscoveryLibrary.ts). Feeds the PREVIOUSLY-UNWIRED "government_feed"
   * source (NT-014 side-finding: the source existed in SOURCE_WEIGHT and
   * franchiseForSource since this file's creation but no signal field ever
   * fed it — a real "built, never wired" defect, not this pass's design).
   * Routes to whichever of ["recall_radar", "echeck_escape_room"]
   * franchiseForSource picks (lowest rotation penalty; ties favor
   * recall_radar) — BOTH require government_source evidence
   * (contentFranchises.ts), so either way an operator must attach the Ohio
   * EPA record before an E-Check reel renders autonomously.
   */
  governmentFeedTopics?: string[];
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
  // Below coverage_gap on purpose: a curated seed list is a cold-start
  // fallback, not a read of THIS business — coverage_gap at least reflects
  // what the shop's own recent content actually is.
  local_discovery: 15,
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The SUBJECT of a topic — the part before the editorial framing.
 *
 * `declinedWorkTopics` builds each topic from a per-category TEMPLATE:
 * "<part>: what a driver actually feels when it is going, and why this is the
 * category we do not tell people to wait on". Four different parts in one
 * category therefore share an eleven-word tail and differ by two or three
 * words, which made the word-overlap check below read them as the same topic.
 *
 * Measured against production 2026-09-07: ALL EIGHT declined-work candidates
 * were suppressed, and four of those were false — "the front hub or bearing",
 * "the tie rod end inner" and "the front strut assembly" were each dropped as
 * duplicates of "the lower control arm", and "the alternator" was dropped as a
 * duplicate of "the catalytic converter". Those are unrelated repairs.
 *
 * That silenced the highest-weight source in the table (34, above everything)
 * and the only one that is un-generic by construction, leaving the daily topic
 * to `performance_signal` and `coverage_gap` — which is how reels came to be
 * generated under the topics "seasonal" and "Engine".
 */
function subject(s: string): string {
  const i = s.indexOf(": ");
  return i > 0 ? s.slice(0, i) : s;
}

/** Overlap check that tolerates rewording — exact-match dedup lets the same
 *  idea back in wearing different words, which is how a feed gets repetitive
 *  while every row looks unique.
 *
 *  Compares SUBJECTS when both sides declare one, so shared boilerplate cannot
 *  mask a different subject. Two topics about the same part still collide —
 *  identical subjects overlap completely — so this loosens nothing that the
 *  check was actually there to catch. */
export function isNearDuplicate(candidate: string, priors: string[]): boolean {
  const candSubject = subject(norm(candidate));
  for (const p of priors) {
    const priorNorm = norm(p);
    // Only compare head-to-head when BOTH carry a template separator. Against a
    // free-form prior ("You just hit a pothole on Euclid Ave...") the whole
    // string is the subject, and truncating one side would compare a fragment.
    const bothTemplated = candSubject !== norm(candidate) && subject(priorNorm) !== priorNorm;
    const left = bothTemplated ? candSubject : norm(candidate);
    const right = bothTemplated ? subject(priorNorm) : priorNorm;

    const a = new Set(left.split(" ").filter((w) => w.length > 3));
    const b = new Set(right.split(" ").filter((w) => w.length > 3));
    if (a.size === 0 || b.size === 0) continue;
    let shared = 0;
    for (const w of a) if (b.has(w)) shared++;
    if (shared / Math.min(a.size, b.size) >= 0.6) return true;
  }
  return false;
}

/**
 * Minimum specificity for something to be worth scripting.
 *
 * `performance_signal` emits analytics THEME LABELS ("seasonal", "community",
 * "promo") and `coverage_gap` emits bare SERVICE CATEGORIES ("Engine",
 * "Brakes", "Tires & Wheels"). Neither is a topic — nobody can write a
 * six-beat script about the word "promo" — yet performance_signal scores 30,
 * second only to declined work, so with declined work suppressed these WON the
 * daily pick. Production evidence: reel job 1830003's stored topic is the
 * single word "Engine", and 1830001's antecedent chain shows the same shape.
 *
 * ONE WORD is the bar, and it is deliberately that low. A first attempt
 * required four words and broke two existing tests whose fixtures — "brake
 * noise", "exhaust work" — are perfectly good two-word topics. Those tests
 * were right and the bar was wrong: the defect is not shortness, it is that a
 * value lifted verbatim out of a fixed enum is a LABEL, and every real offender
 * ("seasonal", "community", "promo", "Engine", "Brakes", "Cooling", "Fluids",
 * "Suspension") happens to be a single word.
 *
 * This is a floor, not the mechanism. The mechanism is the ranking: declined
 * work scores 34 and wins outright once it is no longer suppressed, so labels
 * return to the low-ranked fallback role they were designed for. The floor
 * only matters on a day when every higher source is genuinely empty — and on
 * that day the honest outcome is the manifest fallback, which announces
 * itself, rather than a reel titled "Engine".
 */
export function isScriptableTopic(topic: string): boolean {
  return norm(topic).split(" ").filter(Boolean).length > 1;
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
    // No franchise here requires government_source evidence — local_discovery
    // deliberately excludes E-Check topics (those feed government_feed
    // instead, above) so this source never needs an operator evidence attach.
    local_discovery: ["cleveland_car_survival", "rust_files", "mechanic_myth_lab"],
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
    // Before dedup: a bare category label is not a topic at all, so it should
    // not occupy a candidate slot NOR suppress a real topic behind it.
    if (!isScriptableTopic(topic)) return;
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
  for (const t of signals.localDiscoveryTopics ?? []) add(t, "local_discovery");
  for (const t of signals.governmentFeedTopics ?? []) add(t, "government_feed");

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
