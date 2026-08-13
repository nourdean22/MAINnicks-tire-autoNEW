/**
 * Local Discovery content library (ScanFinish NT-014) — a curated seed list
 * of Cleveland/Euclid-relevant topic PROMPTS for when the business-signal
 * sources (declined work, reviews, customer questions) are thin. Same
 * pattern as `seasonalConditionsForMonth` in contentTopicSignals.ts: a
 * curated list, not a live feed, because a fabricated live feed would put an
 * unsourced claim in a caption. A topic prompt is a starting point for
 * generation, not a fact — `generateReelBriefAI`'s own grounding/evidence
 * requirements (reelBriefGen.ts's HARD REQUIREMENT — SOURCE GROUNDING) still
 * apply to whatever gets written from it.
 *
 * NHTSA/recall-specific content stays OUT of this file on purpose —
 * `contentTopicMiner.ts`'s own comment already establishes why (NHTSA/Ohio
 * EPA block automated fetching; a recall claim needs `government_source`
 * evidence an operator must attach by hand). Entries here are general/
 * educational — "why might my car fail E-Check" not "NHTSA recall #12345" —
 * so they can render without that gate.
 *
 * E-Check facts verified before writing this (2026-08-13, brief's own
 * "web search before hard-coding an assumption" mandate): Nick's Tire sits
 * in Euclid, Cuyahoga County — ONE of Ohio's seven E-Check counties
 * (Cuyahoga, Geauga, Lake, Lorain, Medina, Portage, Summit), so this is a
 * genuinely applicable local topic, not a guess. Source: Ohio EPA
 * (epa.ohio.gov/divisions-and-offices/air-pollution-control/e-check) and
 * ohioecheck.info. A 2026 legislative effort to end the program is in
 * motion (Spectrum News, 2026-04-16) — topic phrasing below stays general
 * ("does my car need E-Check") rather than asserting a permanent schedule.
 */

export type LocalDiscoveryCategory = "tire_symptom" | "e_check" | "weather_road";

export interface LocalDiscoveryEntry {
  id: string;
  category: LocalDiscoveryCategory;
  /** A topic PROMPT, not a claim — the generator still has to ground it. */
  topic: string;
}

export const LOCAL_DISCOVERY_LIBRARY: readonly LocalDiscoveryEntry[] = [
  // tire_symptom — Cleveland/Euclid road conditions (potholes, salt, freeze-thaw)
  { id: "ld_tire_pothole_sidewall", category: "tire_symptom", topic: "why a pothole hit on a Euclid road can bulge a tire sidewall without a visible flat" },
  { id: "ld_tire_salt_wheel_corrosion", category: "tire_symptom", topic: "how Cleveland road salt corrodes wheel rims and causes a slow leak at the bead" },
  { id: "ld_tire_freeze_thaw_pressure", category: "tire_symptom", topic: "why tire pressure drops fastest during Cleveland's first hard freeze of the season" },
  { id: "ld_tire_offroad_curb_damage", category: "tire_symptom", topic: "how curb strikes from tight Euclid street parking cause hidden sidewall damage" },
  { id: "ld_tire_winter_tread_depth", category: "tire_symptom", topic: "how much tread depth actually matters for grip on Cleveland's icy side streets" },

  // e_check — general/educational, Euclid is IN Cuyahoga County (an E-Check county)
  { id: "ld_echeck_who_needs_it", category: "e_check", topic: "does my car need Ohio E-Check emissions testing in Cuyahoga County" },
  { id: "ld_echeck_common_fail_reasons", category: "e_check", topic: "common reasons a car fails Ohio E-Check and what a shop can actually fix" },
  { id: "ld_echeck_check_engine_light", category: "e_check", topic: "why a check engine light almost always means an automatic E-Check fail" },
  { id: "ld_echeck_before_you_go", category: "e_check", topic: "what to have checked before an E-Check appointment so you don't drive back twice" },

  // weather_road — Cleveland/Euclid seasonal and road-specific issues
  { id: "ld_weather_lake_effect_snow", category: "weather_road", topic: "what lake-effect snow off Lake Erie does to a car's wipers, washer fluid and visibility" },
  { id: "ld_weather_black_ice_side_streets", category: "weather_road", topic: "why black ice on shaded Euclid side streets is worse than the main roads" },
  { id: "ld_weather_pothole_season", category: "weather_road", topic: "why Cleveland's freeze-thaw cycle is what actually creates pothole season" },
  { id: "ld_weather_road_salt_undercarriage", category: "weather_road", topic: "what a winter of road salt does to a car's undercarriage and brake lines" },
  { id: "ld_weather_summer_heat_battery", category: "weather_road", topic: "why summer heat, not winter cold, is what actually kills a car battery first" },
] as const;

/** Same near-duplicate suppression the miner already uses for recentTopics —
 *  library entries recycle across cold-start runs unless filtered here too. */
export function localDiscoveryTopics(exclude: string[] = []): string[] {
  const excludeNorm = exclude.map((t) => t.trim().toLowerCase());
  return LOCAL_DISCOVERY_LIBRARY.filter((e) => !excludeNorm.includes(e.topic.toLowerCase())).map((e) => e.topic);
}

export function categoryForTopic(topic: string): LocalDiscoveryCategory | null {
  return LOCAL_DISCOVERY_LIBRARY.find((e) => e.topic === topic)?.category ?? null;
}
