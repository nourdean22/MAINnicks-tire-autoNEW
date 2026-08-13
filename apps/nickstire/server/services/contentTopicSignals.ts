/**
 * Live signal gathering for the content topic miner.
 *
 * The miner itself (shared/contentTopicMiner.ts) is pure: signals in, ranked
 * candidates out. This is the IO half — it reads what the business actually
 * knows and hands it over.
 *
 * Every source here degrades independently and LOUDLY. A miner that silently
 * returns fewer candidates because one query threw looks identical to a miner
 * with genuinely less to say, and the difference matters: one is a quiet
 * outage, the other is a real quiet week.
 *
 * WHAT IS DELIBERATELY NOT HERE: NHTSA and Ohio E-Check. Both block automated
 * fetching (`snapshotStatus: "fetch_blocked"`, established by the URL truth
 * audit). Government-evidence topics are still surfaced by the miner — with
 * `blockedReason` set and excluded from autoRenderable() — so the opportunity
 * is visible without pretending it can be sourced.
 */
import { createLogger } from "../lib/logger";
import { SERVICE_CATEGORIES } from "../../shared/serviceTypes";
import type { TopicSignals } from "../../shared/contentTopicMiner";
import type { FranchiseId } from "../../shared/contentFranchises";
import { LOCAL_DISCOVERY_LIBRARY, localDiscoveryTopics } from "../../shared/localDiscoveryLibrary";

const log = createLogger("services:content-topic-signals");

export interface SignalGatherReport {
  signals: TopicSignals;
  /** Sources that failed, by name. Surfaced so a degraded run is visible. */
  failed: string[];
  /** Sources that returned nothing — different from failing. */
  empty: string[];
}

/** Month → conditions worth talking about in Cleveland. Derived from the
 *  calendar rather than a weather API: no NWS integration exists here, and
 *  inventing one would put an unsourced forecast into a caption. A month is a
 *  fact; a forecast is a claim. */
export function seasonalConditionsForMonth(month: number): string[] {
  const byMonth: Record<number, string[]> = {
    0: ["deep cold and tire pressure loss", "battery strain in sustained freeze"],
    1: ["road salt corrosion at its peak", "pothole season opening as roads freeze and thaw"],
    2: ["pothole damage after the thaw", "alignment after winter"],
    3: ["spring tire changeover", "wiper blades after winter"],
    4: ["road trip preparation", "tread depth before rain season"],
    5: ["summer heat and battery stress", "tire pressure rising in heat"],
    6: ["highway heat and tread wear", "cooling system under load"],
    7: ["late summer road trips", "brake wear after heavy driving"],
    8: ["back-to-school driving", "tread depth before wet season"],
    9: ["first cold mornings and the tire light", "wiper and visibility before dark evenings"],
    10: ["winter tire decision window", "battery testing before the freeze"],
    11: ["first hard freeze and pressure drop", "winter emergency readiness"],
  };
  return byMonth[month] ?? [];
}

/**
 * Service categories with little or no recent reel coverage. A category nobody
 * has made content about is the cheapest kind of new topic — the audience has
 * no fatigue for it and the shop already does the work.
 */
export function underCoveredServices(recentTopics: string[], limit = 4): string[] {
  const hay = recentTopics.join(" ").toLowerCase();
  const uncovered = SERVICE_CATEGORIES.filter((c) => {
    const words = String(c).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
    return words.length > 0 && !words.some((w) => hay.includes(w));
  });
  return uncovered.slice(0, limit).map((c) => String(c));
}

export async function gatherTopicSignals(now: Date = new Date()): Promise<SignalGatherReport> {
  const failed: string[] = [];
  const empty: string[] = [];
  const signals: TopicSignals = {};

  // Recent reel topics — needed for BOTH dedup and coverage-gap detection, so
  // its failure degrades two things at once and is worth naming separately.
  let recentTopics: string[] = [];
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (d) {
      const { reelJobs } = await import("../../drizzle/schema");
      const { desc } = await import("drizzle-orm");
      const rows = await d.select({ payload: reelJobs.payload }).from(reelJobs).orderBy(desc(reelJobs.id)).limit(25);
      for (const r of rows) {
        try {
          const t = (JSON.parse(String(r.payload ?? "{}")) as { topic?: string }).topic;
          if (t) recentTopics.push(t);
        } catch { /* a malformed payload is not a signal failure */ }
      }
    }
  } catch (e) {
    failed.push("recent_topics");
    log.warn("recent reel topics unavailable — dedup and coverage detection degrade", { e: String(e) });
  }
  if (recentTopics.length) signals.recentTopics = recentTopics;
  else empty.push("recent_topics");

  // What actually performed. getReelGenerationSignal is REELS-first since
  // NT-002 (2026-08-13); when too few reel rows exist it falls back to
  // all-media and SAYS so — record that provenance instead of hiding it, the
  // same disclosure discipline as topicOrigin in the cron log.
  try {
    const { getReelGenerationSignal } = await import("../pipelines/instagram-data");
    const sig = await getReelGenerationSignal();
    if (sig.topThemes.length) {
      signals.topThemes = sig.topThemes;
      if (sig.signalSource === "all_media") empty.push("performance_themes_reels_only");
    } else empty.push("performance_themes");
  } catch (e) {
    failed.push("performance_themes");
    log.warn("reel generation signal unavailable", { e: String(e) });
  }

  // Verified review themes — the only source that can feed Review Reconstructed,
  // which is the one franchise permitted to depict a real (labelled) event.
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (d) {
      const { customerTestimonials } = await import("../../drizzle/schema");
      const { desc } = await import("drizzle-orm");
      const rows = await d
        .select({ text: customerTestimonials.text })
        .from(customerTestimonials)
        .orderBy(desc(customerTestimonials.id))
        .limit(12);
      const themes = (rows as Array<{ text: string | null }>)
        .map((r) => String(r.text ?? "").trim())
        .filter((t: string) => t.length > 24)
        .map((t: string) => t.slice(0, 120));
      if (themes.length) signals.reviewThemes = themes;
      else empty.push("review_themes");
    }
  } catch (e) {
    failed.push("review_themes");
    log.warn("review themes unavailable — Review Reconstructed cannot be fed", { e: String(e) });
  }

  signals.seasonalConditions = seasonalConditionsForMonth(now.getMonth());
  signals.underCoveredServices = underCoveredServices(recentTopics);

  // Local Discovery library (NT-014) — cold-start seed prompts, deduped
  // against recent topics same as every other source. Split by category so
  // e_check keeps routing through the government-evidence-gated franchise
  // (see contentTopicMiner.ts's TopicSignals doc) rather than bypassing it.
  const fresh = localDiscoveryTopics(recentTopics);
  const echeckSet = new Set(LOCAL_DISCOVERY_LIBRARY.filter((e) => e.category === "e_check").map((e) => e.topic));
  signals.localDiscoveryTopics = fresh.filter((t) => !echeckSet.has(t));
  signals.governmentFeedTopics = fresh.filter((t) => echeckSet.has(t));

  // Franchise rotation history, newest first.
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (d) {
      const { contentExperimentAssignments } = await import("../../drizzle/schema");
      const { desc } = await import("drizzle-orm");
      const rows = await d
        .select({ f: contentExperimentAssignments.franchiseId })
        .from(contentExperimentAssignments)
        .orderBy(desc(contentExperimentAssignments.id))
        .limit(10);
      const recent = (rows as Array<{ f: string | null }>).map((r) => r.f).filter(Boolean) as FranchiseId[];
      if (recent.length) signals.recentFranchises = recent;
    }
  } catch {
    // Brand-new table (0108) with no rows yet is the normal case, not a fault —
    // rotation simply has no history to honour on the first runs.
  }

  // Declined work — repairs a customer was quoted and refused. Highest-weight
  // source in the miner: un-generic by construction, because no other shop has
  // this list. Counts and dollars are used for RANKING inside declinedWorkTopics
  // and never travel into the brief.
  try {
    const { fetchDeclinedWorkTopics } = await import("./declinedWorkSignals");
    const declined = await fetchDeclinedWorkTopics(8);
    if (declined.candidates.length) {
      signals.declinedWork = declined.candidates.map((c) => c.topic);
    } else {
      empty.push("declined_work");
    }
    if (declined.error) failed.push("declined_work");
  } catch (e) {
    failed.push("declined_work");
    log.warn("declined-work signal unavailable — the strongest topic source is missing", { e: String(e) });
  }

  if (failed.length) {
    log.warn("topic signal gathering DEGRADED — fewer candidates than the business actually supports", { failed, empty });
  }
  return { signals, failed, empty };
}
