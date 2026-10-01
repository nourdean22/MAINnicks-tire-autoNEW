/**
 * Real-asset-first retrieval (Creative Intelligence OS §K.3).
 *
 * "Do we own a real photo stronger than synthetic for this topic?" — asked
 * by igAutopost, reelDraftPrep and carouselDirector before they spend on a
 * generated image. The answer is scored against the typed enrichment that
 * `mediaEnrichment` wrote, so an UNENRICHED pool is reported as exactly
 * that: no enrichment means the asset cannot be matched, not that no asset
 * exists.
 *
 * Subject/service inference asks `shared/topicGraph.ts` first (symptom →
 * part/service edges, the one customer-vocabulary bank in the repo) and
 * falls back to a local keyword map for phrases the graph has no claim on
 * — the graph landed mid-wave (2026-10-01), so the map stays as the floor.
 *
 * Three honest outcomes, never collapsed (empty-vs-error):
 *   matched      — a row cleared the threshold
 *   no_match     — enriched rows exist, none fit (why[] names the best loser)
 *   pool_empty / pool_unenriched — nothing to score
 *   error / no_db — the read FAILED; the caller must not treat this as "no assets"
 */
import type { DB } from "../db";
import { createLogger } from "../lib/logger";
import type { RealAssetRef } from "../../shared/reelJobPayload";
import { neighbors, routesForSymptom, symptomForPhrase } from "../../shared/topicGraph";
import { ENRICHMENT_SUBJECTS, serviceRoutePaths, type EnrichmentSubject, type MediaEnrichment } from "./mediaEnrichment";

const log = createLogger("services:real-asset-first");

/** Below this a match is not offered. Needs subject + one more signal, or subject + service alone. */
export const REAL_ASSET_MIN_SCORE = 0.6;
/** Enrichment quality floor; an asset the model judged unusable is never offered. */
const REAL_ASSET_MIN_QUALITY = 0.4;

const SUBJECT_KEYWORDS: Record<EnrichmentSubject, readonly string[]> = {
  tire: ["tire", "tires", "tread", "sidewall", "flat", "puncture", "plug", "patch", "blowout", "dry rot", "tpms", "pressure", "winter tires", "snow tires", "used tires"],
  // "brake(s)" implicates BOTH wear parts; the symptom words break the tie
  // (grinding/pulsating → rotor primary, squeal/wear indicator → pad primary).
  rotor: ["rotor", "rotors", "disc", "warped", "grinding", "grind", "pulsat", "scored", "grooved", "brake", "brakes"],
  pad: ["pad", "pads", "squeal", "squeak", "wear indicator", "metal on metal", "brake", "brakes"],
  belt: ["belt", "serpentine", "timing belt", "pulley", "tensioner"],
  battery: ["battery", "terminal", "corrosion", "no start", "won't start", "wont start", "jump", "dead battery", "alternator"],
  wheel: ["wheel", "rim", "bent rim", "lug", "hubcap", "bearing"],
  suspension: ["suspension", "strut", "shock", "control arm", "ball joint", "tie rod", "bushing", "sway bar", "clunk", "bounce", "alignment"],
  printout: ["printout", "scan", "code", "diagnostic", "report", "inspection sheet", "invoice", "receipt", "alignment report"],
  other: [],
};

/** Keys are canonical service route paths; `assertServiceKeywordsAreRoutes` pins that against shared/routes.ts. */
const SERVICE_KEYWORDS: Record<string, readonly string[]> = {
  "/brakes": ["brake", "brakes", "rotor", "pad", "caliper", "grinding", "squeal", "stopping"],
  "/used-tires-cleveland": ["used tire", "used tires", "tread", "flat", "puncture", "sidewall", "tire"],
  "/wheel-alignment-cleveland": ["alignment", "pulling", "pulls left", "pulls right", "crooked wheel", "uneven wear"],
  "/check-engine-light-diagnostic": ["check engine", "engine light", "diagnostic", "code", "scan"],
  "/battery": ["battery", "no start", "won't start", "wont start", "jump", "terminal"],
  "/starter-alternator": ["starter", "alternator", "charging", "clicking"],
  "/belts-hoses": ["belt", "hose", "serpentine", "timing belt", "squeal", "coolant leak"],
  "/cooling": ["radiator", "overheat", "overheating", "coolant", "thermostat", "water pump"],
  "/exhaust": ["exhaust", "muffler", "catalytic", "loud", "rumble"],
  "/synthetic-oil-change": ["oil", "oil change", "synthetic"],
  "/ac-repair": ["ac", "a/c", "air conditioning", "blowing warm", "compressor"],
  "/transmission": ["transmission", "shifting", "slipping", "gear"],
  "/electrical": ["electrical", "wiring", "fuse", "short", "parasitic"],
  "/pre-purchase-inspection": ["pre-purchase", "used car", "before you buy", "inspection"],
  "/wheels": ["wheel", "rim", "bent rim", "lug"],
  "/general-repair": ["suspension", "strut", "shock", "control arm", "ball joint", "tie rod", "clunk"],
};

/** topicGraph part node id (without `part:`) → the enrichment subject a camera can capture. Unmapped parts are not guessed. */
const GRAPH_PART_SUBJECT: Record<string, EnrichmentSubject> = {
  rotors: "rotor",
  pads: "pad",
  tire_balance: "tire", tire_wear: "tire", puncture: "tire", tpms_sensor: "tire",
  bent_wheel: "wheel", wheel_bearing: "wheel",
  tie_rod: "suspension", control_arm: "suspension", strut: "suspension", sway_bar_link: "suspension",
  battery: "battery", battery_terminals: "battery",
  serpentine_belt: "belt",
  drive_cycle: "printout",
};

/** What the topic graph says a phrase needs: parts in edge order, first service-group route. Empty when the graph has no claim. */
function graphNeed(text: string): { subjects: EnrichmentSubject[]; service: string | null } {
  const symptom = symptomForPhrase(text);
  if (!symptom) return { subjects: [], service: null };
  const subjects = neighbors(`symptom:${symptom}`, ["part"])
    .map((n) => GRAPH_PART_SUBJECT[n.id.replace(/^part:/, "")])
    .filter((s): s is EnrichmentSubject => Boolean(s));
  const servicePaths = new Set(serviceRoutePaths());
  const service = routesForSymptom(symptom).find((p) => servicePaths.has(p)) ?? null;
  return { subjects: [...new Set(subjects)], service };
}

/** Every service key must be a real route, or a matched "service" is an invented page. */
export function assertServiceKeywordsAreRoutes(): string[] {
  const paths = new Set(serviceRoutePaths());
  return Object.keys(SERVICE_KEYWORDS).filter((k) => !paths.has(k));
}

export interface RealAssetNeed {
  /** Ordered by keyword hit count; the first is the primary subject. */
  subjects: EnrichmentSubject[];
  service: string | null;
  /** Lowercased tokens (len > 3) from the topic + caller-supplied symptoms. */
  symptomTokens: string[];
}

export interface FindRealAssetInput {
  topic: string;
  service?: string;
  symptoms?: string[];
  /** Caller already knows the subject (e.g. a pack brief) — wins over inference. */
  subjectHints?: string[];
}

const tokenize = (text: string): string[] =>
  text.toLowerCase().split(/[^a-z0-9/]+/).filter((w) => w.length > 3);

function countHits(text: string, keywords: readonly string[]): number {
  return keywords.reduce((n, kw) => (text.includes(kw) ? n + 1 : n), 0);
}

export function inferRealAssetNeed(input: FindRealAssetInput): RealAssetNeed {
  const text = `${input.topic} ${(input.symptoms ?? []).join(" ")}`.toLowerCase();
  const hinted = (input.subjectHints ?? [])
    .map((h) => h.toLowerCase().trim())
    .filter((h): h is EnrichmentSubject => (ENRICHMENT_SUBJECTS as readonly string[]).includes(h));
  const graph = graphNeed(text);
  const scored = ENRICHMENT_SUBJECTS
    .filter((s) => s !== "other")
    .map((s) => ({ s, n: countHits(text, SUBJECT_KEYWORDS[s]) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((x) => x.s);
  // Caller hint > graph (mechanic edge order) > keyword map (hit count).
  const subjects = [...new Set([...hinted, ...graph.subjects, ...scored])];

  let service: string | null = null;
  if (input.service && serviceRoutePaths().includes(input.service)) {
    service = input.service;
  } else if (graph.service) {
    service = graph.service;
  } else {
    const best = Object.entries(SERVICE_KEYWORDS)
      .map(([path, kws]) => ({ path, n: countHits(text, kws) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)[0];
    service = best?.path ?? null;
  }
  return { subjects, service, symptomTokens: [...new Set(tokenize(text))] };
}

/**
 * Pure scorer. subject 0.5 · service 0.3 · symptom overlap up to 0.2, scaled
 * by enrichment quality. A subject the need did not ask for zeroes the
 * score outright — a sharp photo of the wrong part is still the wrong part.
 */
export function scoreRealAsset(
  need: RealAssetNeed,
  enrichment: Pick<MediaEnrichment, "subject" | "service" | "symptoms" | "failureMode" | "quality">,
  opts: { minQuality?: number } = {},
): { score: number; why: string[] } {
  const why: string[] = [];
  const minQuality = opts.minQuality ?? REAL_ASSET_MIN_QUALITY;
  if (enrichment.quality !== undefined && enrichment.quality < minQuality) {
    return { score: 0, why: [`quality ${enrichment.quality.toFixed(2)} below floor ${minQuality}`] };
  }
  let score = 0;
  if (enrichment.subject) {
    if (need.subjects.includes(enrichment.subject)) {
      score += 0.5;
      why.push(`subject ${enrichment.subject} matches`);
    } else if (need.subjects.length) {
      return { score: 0, why: [`subject ${enrichment.subject} is not one of ${need.subjects.join("/")}`] };
    }
  } else {
    why.push("no subject in enrichment");
  }
  if (need.service && enrichment.service === need.service) {
    score += 0.3;
    why.push(`service ${need.service} matches`);
  }
  const hay = `${(enrichment.symptoms ?? []).join(" ")} ${enrichment.failureMode ?? ""}`.toLowerCase();
  const overlap = need.symptomTokens.filter((t) => hay.includes(t));
  if (overlap.length) {
    score += Math.min(0.2, 0.1 * overlap.length);
    why.push(`symptom overlap: ${overlap.slice(0, 3).join(", ")}`);
  }
  if (enrichment.quality !== undefined) {
    score *= 0.6 + 0.4 * enrichment.quality;
    why.push(`quality ${enrichment.quality.toFixed(2)}`);
  } else {
    why.push("quality unknown — not scaled");
  }
  return { score: Math.round(score * 1000) / 1000, why };
}

export interface RealAssetMatch {
  assetId: string;
  runtimeUrl: string;
  mimeType: string;
  enrichment: MediaEnrichment;
  score: number;
  why: string[];
}

export type RealAssetLookup =
  | { state: "matched"; match: RealAssetMatch; why: string[] }
  | { state: "no_match" | "pool_empty" | "pool_unenriched"; match: null; why: string[] }
  | { state: "error" | "no_db"; match: null; why: string[]; error: string };

export function toRealAssetRef(m: RealAssetMatch): RealAssetRef {
  const { subject, service, symptoms, failureMode, visibleEvidence, safeClaims, quality, season } = m.enrichment;
  return {
    assetId: m.assetId,
    url: m.runtimeUrl,
    score: m.score,
    why: m.why,
    enrichment: { subject, service, symptoms, failureMode, visibleEvidence, safeClaims, quality, season },
  };
}

/**
 * Best real-shop asset for a topic, or an explicit reason there is none.
 * The pool read is the registry's own reader (`listReusableRealShopMedia`),
 * so rights/lifecycle/reuse gating is never re-implemented here.
 */
export async function findRealAssetFor(
  input: FindRealAssetInput,
  opts: { minScore?: number; minQuality?: number; database?: DB } = {},
): Promise<RealAssetLookup> {
  const minScore = opts.minScore ?? REAL_ASSET_MIN_SCORE;
  const need = inferRealAssetNeed(input);
  const needWhy = `need: subjects=${need.subjects.join("/") || "(none)"} service=${need.service ?? "(none)"}`;
  if (!need.subjects.length && !need.service) {
    return { state: "no_match", match: null, why: [needWhy, "topic names no capturable subject or service"] };
  }
  let database: DB | null;
  try {
    database = opts.database ?? (await (await import("../db")).getDbTyped());
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { state: "error", match: null, why: [needWhy], error };
  }
  if (!database) return { state: "no_db", match: null, why: [needWhy], error: "database unavailable — real-shop pool is unknown, not empty" };

  let rows: Awaited<ReturnType<typeof import("./instagramAdminStrategy").listReusableRealShopMedia>>;
  try {
    const { listReusableRealShopMedia } = await import("./instagramAdminStrategy");
    rows = await listReusableRealShopMedia(database);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn("real-shop pool read failed — reporting error, not empty", { error });
    return { state: "error", match: null, why: [needWhy], error };
  }
  if (!rows.length) return { state: "pool_empty", match: null, why: [needWhy, "real_shop pool has no reusable images"] };
  const enriched = rows.flatMap((r) => (r.enrichment ? [{ row: r, enrichment: r.enrichment }] : []));
  if (!enriched.length) {
    return { state: "pool_unenriched", match: null, why: [needWhy, `${rows.length} real_shop image(s) exist but none is enriched yet`] };
  }

  let best: RealAssetMatch | null = null;
  for (const { row, enrichment } of enriched) {
    const { score, why } = scoreRealAsset(need, enrichment, { minQuality: opts.minQuality });
    if (!best || score > best.score) {
      best = { assetId: row.id, runtimeUrl: row.url, mimeType: row.mimeType, enrichment, score, why };
    }
  }
  if (!best || best.score < minScore) {
    return {
      state: "no_match",
      match: null,
      why: [needWhy, `${enriched.length} enriched asset(s) scored; best ${best ? `${best.assetId} at ${best.score}` : "none"} < ${minScore}`],
    };
  }
  return { state: "matched", match: best, why: [needWhy, ...best.why, `score ${best.score} ≥ ${minScore}`] };
}
