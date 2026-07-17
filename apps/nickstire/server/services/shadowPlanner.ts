/**
 * Shadow opportunity planner — Long Haul milestone 11 (ledger: shadow-planner).
 *
 * Stage 0 of the earned-autonomy ladder: the planner OBSERVES real signals
 * and RECOMMENDS ranked campaign opportunities with reasoning codes. It is
 * structurally incapable of acting — this module imports no provider,
 * publish, enqueue, or generation code, and a test enforces that with a
 * source-level scan. Scoring is fully deterministic (no model calls): the
 * same signals always produce the same plan, so operator-vs-planner
 * comparison is meaningful.
 *
 * Signals used TODAY (each available-flagged, never silently zero):
 *   - creative memory fingerprints (repetition control)
 *   - published inventory topics (30-day repetition window)
 *   - live weather triggers (weatherIntelligence)
 *   - Cleveland calendar month (seasonal playbook)
 * Evidence strength scores LOW while the evidence tables are starved — the
 * planner says so with a code instead of pretending grounding exists.
 */
import { createLogger } from "../lib/logger";
import type { CampaignObjective } from "../../client/src/lib/creativeGenome";

const log = createLogger("services:shadow-planner");

export interface SeasonalMoment {
  id: string;
  audienceMoment: string;
  campaignKeyword: string;
  creativeTerritory: string;
  objective: CampaignObjective;
  /** months (1-12) when this moment is live in Cleveland */
  months: number[];
  urgency: number; // 0-15
  marginClass: "high" | "medium" | "low";
  weatherTriggers?: string[]; // ids from weatherIntelligence that boost this
}

/** Cleveland seasonal playbook — deterministic candidate source. */
export const SEASONAL_PLAYBOOK: SeasonalMoment[] = [
  { id: "pothole_thaw", audienceMoment: "Freeze-thaw potholes eating wheels on the commute", campaignKeyword: "POTHOLE", creativeTerritory: "road_villain", objective: "save", months: [1, 2, 3, 4], urgency: 13, marginClass: "high", weatherTriggers: ["freeze_thaw"] },
  { id: "first_freeze_battery", audienceMoment: "First hard freeze exposes weak batteries in driveways", campaignKeyword: "BATTERY", creativeTerritory: "weather_local_alert", objective: "save", months: [10, 11, 12, 1], urgency: 14, marginClass: "medium", weatherTriggers: ["first_freeze", "cold_snap"] },
  { id: "winter_tread", audienceMoment: "Bald tires meeting the season's first lake-effect snow", campaignKeyword: "TREAD", creativeTerritory: "cleveland_survival_guide", objective: "booking", months: [10, 11, 12], urgency: 14, marginClass: "high", weatherTriggers: ["snow_incoming"] },
  { id: "salt_undercarriage", audienceMoment: "Road salt quietly eating brake lines and rockers", campaignKeyword: "SALT", creativeTerritory: "csi_evidence_board", objective: "save", months: [12, 1, 2, 3], urgency: 10, marginClass: "medium" },
  { id: "summer_pressure", audienceMoment: "Heat swings blowing tire pressure past the door-sticker number", campaignKeyword: "PRESSURE", creativeTerritory: "mechanic_translation", objective: "save", months: [6, 7, 8], urgency: 9, marginClass: "medium" },
  { id: "roadtrip_check", audienceMoment: "Road-trip season on tires that have not been looked at since winter", campaignKeyword: "TIRES", creativeTerritory: "before_the_bill", objective: "booking", months: [5, 6, 7, 8], urgency: 10, marginClass: "high" },
  { id: "rain_wipers", audienceMoment: "First heavy rains after months of dry-rotting wiper blades", campaignKeyword: "WIPERS", creativeTerritory: "warning_system", objective: "shop_visit", months: [3, 4, 5, 9, 10], urgency: 8, marginClass: "low", weatherTriggers: ["heavy_rain"] },
  { id: "echeck_deadline", audienceMoment: "E-Check due with the registration renewal clock ticking", campaignKeyword: "ECHECK", creativeTerritory: "myth_courtroom", objective: "shop_visit", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], urgency: 7, marginClass: "medium" },
  { id: "vibration_highway", audienceMoment: "Highway vibration drivers keep blaming on the road", campaignKeyword: "VIBRATION", creativeTerritory: "car_body_language", objective: "message", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], urgency: 6, marginClass: "medium" },
  { id: "brake_noise", audienceMoment: "That first metallic scrape drivers turn the radio up over", campaignKeyword: "BRAKES", creativeTerritory: "warning_system", objective: "booking", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], urgency: 11, marginClass: "high" },
  { id: "alignment_after_winter", audienceMoment: "Steering pulling ever since that one pothole in February", campaignKeyword: "ALIGNMENT", creativeTerritory: "csi_evidence_board", objective: "booking", months: [3, 4, 5, 6], urgency: 9, marginClass: "high" },
  { id: "tpms_light", audienceMoment: "The tire-pressure light drivers have been ignoring for weeks", campaignKeyword: "TPMS", creativeTerritory: "warning_system", objective: "save", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], urgency: 8, marginClass: "low" },
];

export interface PlannerSignals {
  month: number; // 1-12, Cleveland calendar
  fingerprints: { available: boolean; values: string[] };
  recentTopics: { available: boolean; values: string[] };
  weather: { available: boolean; triggered: string[] };
  evidenceTables: { available: boolean; populated: boolean };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export async function collectPlannerSignals(now: Date = new Date()): Promise<PlannerSignals> {
  const month = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric" }).format(now));
  const signals: PlannerSignals = {
    month,
    fingerprints: { available: false, values: [] },
    recentTopics: { available: false, values: [] },
    weather: { available: false, triggered: [] },
    evidenceTables: { available: false, populated: false },
  };
  try {
    const { recentCreativeFingerprints } = await import("./creativeMemory");
    signals.fingerprints = { available: true, values: await recentCreativeFingerprints(15) };
  } catch { /* stays unavailable */ }
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (d) {
      const { socialContentInventory } = await import("../../drizzle/schema");
      const { gte, isNotNull, and, desc } = await import("drizzle-orm");
      const rows = await d
        .select({ topic: socialContentInventory.topic })
        .from(socialContentInventory)
        .where(and(isNotNull(socialContentInventory.publishedAt), gte(socialContentInventory.publishedAt, new Date(now.getTime() - 30 * 86_400_000))))
        .orderBy(desc(socialContentInventory.publishedAt))
        .limit(30);
      signals.recentTopics = { available: true, values: (Array.isArray(rows) ? rows : []).map((r) => r.topic).filter(Boolean) };

      const { reviewPipeline } = await import("../../drizzle/schema");
      const { sql: dsql } = await import("drizzle-orm");
      try {
        const [cnt] = await d.select({ n: dsql<number>`COUNT(*)` }).from(reviewPipeline);
        signals.evidenceTables = { available: true, populated: Number(cnt?.n ?? 0) > 0 };
      } catch { /* stays unavailable */ }
    }
  } catch { /* stays unavailable */ }
  try {
    const { checkWeatherTriggers } = await import("./weatherIntelligence");
    const w = await checkWeatherTriggers();
    signals.weather = { available: true, triggered: w.triggered ?? [] };
  } catch { /* stays unavailable */ }
  return signals;
}

export interface ShadowOpportunity {
  id: string;
  audienceMoment: string;
  campaignKeyword: string;
  creativeTerritory: string;
  objective: CampaignObjective;
  score: number;
  reasoningCodes: string[];
  rejected: boolean;
}

/** Deterministic 100-pt rubric. Same signals -> same scores, always. */
export function scoreOpportunity(moment: SeasonalMoment, signals: PlannerSignals): ShadowOpportunity {
  const codes: string[] = [];
  let score = 0;

  // Customer relevance (20): in-season fully relevant, off-season floor.
  const inSeason = moment.months.includes(signals.month);
  score += inSeason ? 20 : 4;
  codes.push(inSeason ? "SEASON_MATCH" : "OFF_SEASON");

  // Business value (20): margin class.
  const margin = { high: 20, medium: 13, low: 7 }[moment.marginClass];
  score += margin;
  codes.push(`MARGIN_${moment.marginClass.toUpperCase()}`);

  // Timing & urgency (15): playbook urgency, weather triggers max it out.
  const weatherHit = signals.weather.available && (moment.weatherTriggers ?? []).some((t) => signals.weather.triggered.includes(t));
  score += weatherHit ? 15 : Math.min(15, moment.urgency);
  if (weatherHit) codes.push("WEATHER_TRIGGER_LIVE");

  // Evidence strength (15): honest — starved tables score LOW.
  if (signals.evidenceTables.available && signals.evidenceTables.populated) {
    score += 12;
    codes.push("FIRST_PARTY_EVIDENCE_AVAILABLE");
  } else {
    score += 4; // public-registry grounding only
    codes.push("EVIDENCE_STARVED_PUBLIC_ONLY");
  }

  // Creative potential (10): territory not seen in recent fingerprints.
  const territorySeen = signals.fingerprints.values.some((f) => f.includes(`territory:${moment.creativeTerritory}`));
  score += territorySeen ? 4 : 10;
  codes.push(territorySeen ? "TERRITORY_RECENTLY_USED" : "TERRITORY_FRESH");

  // Format suitability (10): every playbook moment maps to reel+carousel today.
  score += 10;

  // Novelty (5) + hard reject on repetition.
  const momentN = norm(moment.audienceMoment);
  const topicRepeat = signals.recentTopics.values.some((t) => norm(t).includes(momentN.slice(0, 40)) || momentN.includes(norm(t).slice(0, 40)));
  const fingerprintRepeat = signals.fingerprints.values.some((f) => f.includes(norm(moment.audienceMoment).slice(0, 60)));
  if (topicRepeat || fingerprintRepeat) {
    codes.push("HARD_REJECT_REPETITION");
    return { id: moment.id, audienceMoment: moment.audienceMoment, campaignKeyword: moment.campaignKeyword, creativeTerritory: moment.creativeTerritory, objective: moment.objective, score: 0, reasoningCodes: codes, rejected: true };
  }
  score += 5;
  codes.push("NOVEL");

  // Production efficiency (5): existing directors cover it.
  score += 5;

  return { id: moment.id, audienceMoment: moment.audienceMoment, campaignKeyword: moment.campaignKeyword, creativeTerritory: moment.creativeTerritory, objective: moment.objective, score, reasoningCodes: codes, rejected: false };
}

export interface ShadowPlan {
  generatedAt: string;
  month: number;
  signals: PlannerSignals;
  recommendations: ShadowOpportunity[];
  rejected: ShadowOpportunity[];
  shadow: true;
}

/** RECOMMENDATIONS ONLY. Nothing here generates, reserves, schedules, or
 *  publishes — and shadowPlanner.test.ts enforces that at the source level. */
export async function generateShadowPlan(now: Date = new Date()): Promise<ShadowPlan> {
  const signals = await collectPlannerSignals(now);
  const scored = SEASONAL_PLAYBOOK.map((m) => scoreOpportunity(m, signals));
  const recommendations = scored.filter((o) => !o.rejected).sort((a, b) => b.score - a.score).slice(0, 5);
  const rejected = scored.filter((o) => o.rejected);
  log.info("shadow plan generated (recommendations only)", {
    month: signals.month,
    top: recommendations[0]?.id,
    rejected: rejected.length,
  });
  return { generatedAt: now.toISOString(), month: signals.month, signals, recommendations, rejected, shadow: true };
}
