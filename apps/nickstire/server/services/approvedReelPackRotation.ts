/**
 * Operator-approved human-review packs, in the order they enter the daily
 * Reel generator. A pack supplies its reviewed topic; generation, claims,
 * spend, rendered QA, and the publish door remain the normal pipeline's job.
 */
export const APPROVED_REEL_PACK_SLUGS = [
  "2026-08-16-wheel-bearing-hum",
  "2026-08-16-check-engine-light",
  "2026-08-17-balance-vs-alignment",
  "2026-08-17-spare-tire-mileage",
  "2026-08-17-coolant-color",
  "2026-08-17-cabin-air-filter",
  "2026-08-17-stop-driving-noises",
  "2026-08-17-repair-questions",
  "2026-08-17-why-car-pulls",
  "2026-08-17-oil-change-intervals",
  "2026-08-17-summer-heat-tire-pressure",
  "2026-08-17-strut-bounce-test",
  "2026-08-17-exhaust-smoke-color",
  "2026-08-17-tire-rotation",
  "2026-08-17-wiper-blade-check",
  "2026-08-17-pothole-damage",
  "2026-08-17-transmission-fluid-color-test",
  "2026-08-17-plug-vs-patch",
  "2026-08-17-tread-depth-rain-vs-snow",
  "2026-08-17-serpentine-belt-squeal",
  "2026-08-17-roadtrip-tire-check",
  "2026-08-17-road-salt-brake-lines",
  "2026-08-17-sidewall-bulge",
  "2026-08-18-cold-weather-tire-light",
  "2026-08-18-cv-joint-click",
  "2026-08-18-allseason-vs-winter-tires",
  "2026-08-18-brake-fluid-moisture-test",
  "2026-08-18-ac-not-blowing-cold",
  "2026-08-18-uneven-tire-wear-patterns",
  "2026-08-18-tpms-sensor-battery",
  "2026-08-18-power-steering-whine",
  "2026-08-19-wont-start-battery-starter-alternator",
] as const;

export interface ApprovedReelPack {
  slug: (typeof APPROVED_REEL_PACK_SLUGS)[number];
  topic: string;
}

function topicFromSlug(slug: string): string {
  return slug.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ");
}

export const APPROVED_REEL_PACKS: readonly ApprovedReelPack[] = APPROVED_REEL_PACK_SLUGS.map((slug) => ({
  slug,
  topic: topicFromSlug(slug),
}));

/** Returns null for a completed or malformed rotation index. */
export function approvedReelPackAt(index: number): ApprovedReelPack | null {
  if (!Number.isSafeInteger(index) || index < 0) return null;
  return APPROVED_REEL_PACKS[index] ?? null;
}

/** Never silently restart the queue when durable state is malformed. */
export function parseApprovedPackRotationIndex(value: string | null): number | null {
  if (value === null || !/^(0|[1-9]\d*)$/.test(value.trim())) return null;
  const index = Number(value);
  return Number.isSafeInteger(index) ? index : null;
}

/** A missing cursor is the first pack; a malformed cursor is never guessed. */
export function resolveApprovedPackRotationIndex(value: string | null): number | null {
  return value === null ? 0 : parseApprovedPackRotationIndex(value);
}
