/**
 * Trend intelligence (Creative Intelligence OS, PROMPT-PACK §15).
 *
 * A trend is only useful to Nick's if it maps to a service, a symptom or a
 * Cleveland condition the shop can say something TRUE about. This module is
 * deterministic: it classifies candidate trends (NWS alerts, rising GSC
 * queries, operator-supplied items) into use / watch / skip with a reason,
 * and refuses to recommend audio without a licensing note or a meme format
 * that needs someone else's graphics.
 *
 * Sources it does NOT have (Google Trends, Instagram's trend surfaces,
 * Reddit) are reported as `unavailable`, never silently absent.
 */

export type TrendSource = "nws" | "gsc" | "instagram" | "facebook" | "google_trends" | "reddit" | "local_news" | "nhtsa_recall" | "audio" | "operator";

export interface TrendCandidate {
  source: TrendSource;
  text: string;
  firstSeen?: string;
  volume?: number;
  /** required for audio: where the licence comes from */
  licenseNote?: string;
  /** true when adopting the format means reproducing someone else's graphics */
  requiresOthersGraphics?: boolean;
}

export interface TrendVerdict {
  candidate: TrendCandidate;
  nickRelevance: 0 | 1 | 2 | 3 | 4 | 5;
  mapsTo: string[];
  freshness: "fresh" | "aging" | "stale" | "unknown";
  likelyHalfLifeDays: number;
  truthability: "ssot" | "nhtsa" | "observable" | "none";
  feasibility: "deterministic" | "real_shop" | "ai_cinematic" | "none";
  verdict: "use" | "watch" | "skip";
  reason: string;
}

const RELEVANCE_MAP: Array<{ re: RegExp; mapsTo: string; weight: 1 | 2 }> = [
  { re: /\b(snow|ice|freez|frost|wind ?chill|lake.?effect|winter storm)\b/i, mapsTo: "winter / tire pressure / battery / traction", weight: 2 },
  { re: /\b(pothole|road damage|rough road)\b/i, mapsTo: "wheel damage / alignment / suspension", weight: 2 },
  { re: /\b(salt|brine|rust|corrosion)\b/i, mapsTo: "brake lines / subframe / battery terminals", weight: 2 },
  { re: /\b(heat|heat advisory|90s|hot)\b/i, mapsTo: "overheating / AC / tire pressure", weight: 1 },
  { re: /\b(flood|heavy rain|hydroplan)\b/i, mapsTo: "tread depth / wet traction", weight: 2 },
  { re: /\b(e-?check|emission|not ready|check engine)\b/i, mapsTo: "emissions / diagnostics", weight: 2 },
  { re: /\b(tire|tread|flat|puncture|plug|patch|tpms)\b/i, mapsTo: "tires", weight: 2 },
  { re: /\b(brake|rotor|grind|squeal)\b/i, mapsTo: "brakes", weight: 2 },
  { re: /\b(align|shak|vibrat|wobble|pull(s|ing)? (left|right))\b/i, mapsTo: "alignment / balance", weight: 2 },
  { re: /\b(battery|won'?t start|no start|jump)\b/i, mapsTo: "battery / starting", weight: 2 },
  { re: /\b(recall)\b/i, mapsTo: "safety recall (cite NHTSA)", weight: 1 },
  { re: /\b(browns|guardians|cavs|cleveland|euclid|ohio)\b/i, mapsTo: "local moment", weight: 1 },
];

function freshnessOf(firstSeen?: string, now = Date.now()): TrendVerdict["freshness"] {
  if (!firstSeen) return "unknown";
  const age = (now - new Date(firstSeen).getTime()) / 86_400_000;
  if (!Number.isFinite(age)) return "unknown";
  if (age <= 3) return "fresh";
  if (age <= 14) return "aging";
  return "stale";
}

export function classifyTrend(c: TrendCandidate, now = Date.now()): TrendVerdict {
  const mapsTo: string[] = [];
  let score = 0;
  for (const m of RELEVANCE_MAP) if (m.re.test(c.text)) { mapsTo.push(m.mapsTo); score += m.weight; }
  const nickRelevance = Math.min(5, score) as TrendVerdict["nickRelevance"];
  const freshness = freshnessOf(c.firstSeen, now);
  const halfLife = c.source === "nws" ? 3 : c.source === "gsc" ? 30 : c.source === "nhtsa_recall" ? 60 : c.source === "audio" ? 10 : 14;
  const truthability: TrendVerdict["truthability"] = mapsTo.some((m) => m.includes("NHTSA")) ? "nhtsa"
    : mapsTo.length ? (c.source === "nws" || c.source === "gsc" ? "observable" : "ssot") : "none";
  const feasibility: TrendVerdict["feasibility"] = mapsTo.length === 0 ? "none" : c.source === "nws" ? "deterministic" : "real_shop";

  if (c.source === "audio" && !c.licenseNote) {
    return { candidate: c, nickRelevance, mapsTo, freshness, likelyHalfLifeDays: halfLife, truthability, feasibility, verdict: "skip", reason: "audio without a licensing note is never recommended" };
  }
  if (c.requiresOthersGraphics) {
    return { candidate: c, nickRelevance, mapsTo, freshness, likelyHalfLifeDays: halfLife, truthability, feasibility, verdict: "skip", reason: "format depends on reproducing someone else's graphics — originality policy" };
  }
  if (nickRelevance === 0) {
    return { candidate: c, nickRelevance, mapsTo, freshness, likelyHalfLifeDays: halfLife, truthability, feasibility, verdict: "skip", reason: "maps to no service, symptom or Cleveland condition" };
  }
  if (freshness === "stale") {
    return { candidate: c, nickRelevance, mapsTo, freshness, likelyHalfLifeDays: halfLife, truthability, feasibility, verdict: "watch", reason: "relevant but past its half-life; revisit if it recurs" };
  }
  if (nickRelevance >= 2 && truthability !== "none") {
    return { candidate: c, nickRelevance, mapsTo, freshness, likelyHalfLifeDays: halfLife, truthability, feasibility, verdict: "use", reason: `maps to ${mapsTo.join(" + ")} with a truthful angle (${truthability}); ${freshness}` };
  }
  return { candidate: c, nickRelevance, mapsTo, freshness, likelyHalfLifeDays: halfLife, truthability, feasibility, verdict: "watch", reason: "relevant but weakly mapped — needs a Nick's signal before it earns a post" };
}

export interface TrendReport {
  generatedAt: string;
  verdicts: TrendVerdict[];
  unavailable: Array<{ source: TrendSource; reason: string }>;
}

/** Compose the sources the repo actually has; report the rest as unavailable. */
export async function gatherTrends(extra: TrendCandidate[] = []): Promise<TrendReport> {
  const candidates: TrendCandidate[] = [...extra];
  const unavailable: TrendReport["unavailable"] = [
    { source: "google_trends", reason: "no API integration in this repo" },
    { source: "instagram", reason: "no trend surface API; operator-supplied only" },
    { source: "reddit", reason: "not integrated" },
    { source: "audio", reason: "no licensed audio catalogue; operator-supplied with a licence note only" },
  ];
  try {
    const { evaluateWeatherTriggers } = await import("./weatherIntelligence");
    const w = await evaluateWeatherTriggers();
    for (const t of w.triggered) candidates.push({ source: "nws", text: t, firstSeen: new Date().toISOString() });
  } catch (err) {
    unavailable.push({ source: "nws", reason: err instanceof Error ? err.message : String(err) });
  }
  try {
    const mod = await import("./contentTopicSignals") as { gatherTopicSignals: () => Promise<{ signals?: { gscRising?: Array<{ query: string; impressions?: number; firstSeen?: string }> } }> };
    const r = await mod.gatherTopicSignals();
    for (const g of r.signals?.gscRising ?? []) candidates.push({ source: "gsc", text: g.query, volume: g.impressions, firstSeen: g.firstSeen });
  } catch (err) {
    unavailable.push({ source: "gsc", reason: err instanceof Error ? err.message : String(err) });
  }
  const verdicts = candidates.map((c) => classifyTrend(c)).sort((a, b) => b.nickRelevance - a.nickRelevance);
  return { generatedAt: new Date().toISOString(), verdicts, unavailable };
}
