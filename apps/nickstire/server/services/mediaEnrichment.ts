/**
 * Real-shop media enrichment (Creative Intelligence OS §K.1).
 *
 * One vision call per operator-captured photo, persisted under
 * `media_assets.generation_params_json.enrichment` — the column already
 * exists, so this is a typed key, not a schema change. Everything downstream
 * (`realAssetFirst`, the registry filters, the capture-opportunity card)
 * reads THIS shape and nothing else, so the parse is deliberately strict:
 * a field the model did not return is OMITTED, never defaulted. "The model
 * said nothing about the service" and "the service is /brakes" must stay
 * distinguishable, or the retrieval layer scores invented facts.
 *
 * Enrichment never gates the upload: `enrichRealShopAsset` returns
 * `{ skipped, reason }` on every failure path and the caller fires it
 * without awaiting. A missing key, a disabled flag, a garbage reply and a
 * DB error all leave the asset registered and unenriched — which the pool
 * reader reports as "unenriched", not "no match".
 */
import { ALL_ROUTES } from "../../shared/routes";
import { BUSINESS } from "../../shared/business";
import { createLogger } from "../lib/logger";
import type { DB } from "../db";

const log = createLogger("services:media-enrichment");

export const ENRICHMENT_SUBJECTS = [
  "tire", "rotor", "pad", "belt", "battery", "wheel", "suspension", "printout", "other",
] as const;
export type EnrichmentSubject = (typeof ENRICHMENT_SUBJECTS)[number];

const ENRICHMENT_OPPORTUNITIES = ["reel", "carousel", "static", "story", "fb_album"] as const;
export type EnrichmentOpportunity = (typeof ENRICHMENT_OPPORTUNITIES)[number];

const ENRICHMENT_ORIENTATIONS = ["portrait", "landscape", "square"] as const;
export type EnrichmentOrientation = (typeof ENRICHMENT_ORIENTATIONS)[number];

const SEASONS = ["winter", "spring", "summer", "fall"] as const;
export type Season = (typeof SEASONS)[number];

/** Fields the vision model may fill. Every one is optional: absent means "not observed". */
export interface EnrichmentObservation {
  subject?: EnrichmentSubject;
  /** Canonical service route path from shared/routes.ts (group "service"), e.g. "/brakes". */
  service?: string;
  symptoms?: string[];
  failureMode?: string;
  visibleEvidence?: string[];
  /** Observable facts only — the parser drops anything that reads as a price, guarantee or promise. */
  safeClaims?: string[];
  orientation?: EnrichmentOrientation;
  /** 0..1 — usable-for-content quality as judged by the model. */
  quality?: number;
  contentOpportunities?: EnrichmentOpportunity[];
}

export interface MediaEnrichment extends EnrichmentObservation {
  /** Derived from the capture time in the shop's timezone, never from the model. */
  season?: Season;
  provider: string;
  model: string;
  at: string;
}

/** The service paths an enrichment may name — the single source is the route registry. */
export function serviceRoutePaths(): string[] {
  return ALL_ROUTES.filter((r) => r.group === "service").map((r) => r.path);
}

/** Shop-local season for a capture instant. Month is read in America/New_York, never server-local. */
export function seasonFor(at: Date, timeZone: string = BUSINESS.timezone): Season {
  const month = Number(new Intl.DateTimeFormat("en-US", { timeZone, month: "numeric" }).format(at));
  if (month === 12 || month <= 2) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "fall";
}

function buildEnrichmentPrompt(): string {
  return [
    "You are cataloguing a photo taken inside an independent tire and auto-repair shop in Cleveland, Ohio.",
    "Return ONE raw JSON object and nothing else — no markdown fences, no prose.",
    "Keys (omit any key you cannot support from what is VISIBLE in the photo; never guess):",
    `  subject: one of ${ENRICHMENT_SUBJECTS.join(" | ")}`,
    `  service: the ONE matching service page path from this list, or omit: ${serviceRoutePaths().join(", ")}`,
    "  symptoms: array of short driver-facing symptoms this evidence explains (e.g. \"grinding\", \"pulling left\")",
    "  failureMode: one short phrase naming what failed or wore (e.g. \"rotor scored past minimum thickness\")",
    "  visibleEvidence: array of concrete things visible (e.g. \"heat discoloration on rotor face\")",
    "  safeClaims: array of statements that are TRUE from the photo alone. No prices, no guarantees, no timelines, no promises.",
    `  orientation: one of ${ENRICHMENT_ORIENTATIONS.join(" | ")}`,
    "  quality: number 0 to 1 — sharpness, lighting and framing as a social-content asset",
    `  contentOpportunities: array from ${ENRICHMENT_OPPORTUNITIES.join(" | ")}`,
  ].join("\n");
}

const MAX_LIST = 8;
const MAX_STR = 200;

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, MAX_STR) : null;
}

function cleanStringList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map(cleanString).filter((s): s is string => s !== null).slice(0, MAX_LIST);
  return out.length ? out : undefined;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase() as T;
  return allowed.includes(s) ? s : undefined;
}

/** A "safe claim" that quotes money, a guarantee or a timeline is not safe. Observable facts only. */
const UNSAFE_CLAIM = /\$|\bguarantee|\bwarrant|\bfree\b|\bprice|\bcheap|\bminutes?\b|\bhours?\b|\bsame[- ]day|\bbest\b|\bcertified/i;

/**
 * Extract the typed observation from a model reply. Null when no JSON object
 * can be found at all; otherwise only the fields that validate survive.
 * Unknown subjects, non-registry service paths and unsafe claims are dropped,
 * never coerced into something that looks valid.
 */
export function parseEnrichmentReply(reply: string | null | undefined): EnrichmentObservation | null {
  if (!reply) return null;
  const stripped = reply.replace(/```(?:json)?/gi, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: EnrichmentObservation = {};

  const subject = oneOf(o.subject, ENRICHMENT_SUBJECTS);
  if (subject) out.subject = subject;

  const serviceRaw = cleanString(o.service);
  if (serviceRaw) {
    const normalized = (serviceRaw.startsWith("/") ? serviceRaw : `/${serviceRaw}`).toLowerCase().replace(/\/+$/, "");
    if (serviceRoutePaths().includes(normalized)) out.service = normalized;
  }

  const symptoms = cleanStringList(o.symptoms);
  if (symptoms) out.symptoms = symptoms.map((s) => s.toLowerCase());
  const failureMode = cleanString(o.failureMode);
  if (failureMode) out.failureMode = failureMode;
  const visibleEvidence = cleanStringList(o.visibleEvidence);
  if (visibleEvidence) out.visibleEvidence = visibleEvidence;
  const safeClaims = cleanStringList(o.safeClaims)?.filter((c) => !UNSAFE_CLAIM.test(c));
  if (safeClaims?.length) out.safeClaims = safeClaims;

  const orientation = oneOf(o.orientation, ENRICHMENT_ORIENTATIONS);
  if (orientation) out.orientation = orientation;

  if (typeof o.quality === "number" && Number.isFinite(o.quality)) {
    out.quality = Math.max(0, Math.min(1, o.quality));
  }

  if (Array.isArray(o.contentOpportunities)) {
    const ops = o.contentOpportunities
      .map((v) => oneOf(v, ENRICHMENT_OPPORTUNITIES))
      .filter((v): v is EnrichmentOpportunity => v !== undefined);
    if (ops.length) out.contentOpportunities = [...new Set(ops)];
  }
  return out;
}

/**
 * Read a persisted enrichment back out of generation_params_json. Re-validates
 * through the same field pickers, so a hand-edited or corrupted blob can only
 * LOSE fields, never surface an invalid service path or subject.
 */
export function readEnrichment(generationParamsJson: string | null | undefined): MediaEnrichment | null {
  if (!generationParamsJson) return null;
  let meta: unknown;
  try {
    meta = JSON.parse(generationParamsJson);
  } catch {
    return null;
  }
  if (!meta || typeof meta !== "object") return null;
  const e = (meta as { enrichment?: unknown }).enrichment;
  if (!e || typeof e !== "object") return null;
  const rec = e as Record<string, unknown>;
  const provider = cleanString(rec.provider);
  const model = cleanString(rec.model);
  const at = cleanString(rec.at);
  if (!provider || !model || !at) return null;
  const observation = parseEnrichmentReply(JSON.stringify(rec)) ?? {};
  const season = oneOf(rec.season, SEASONS);
  return { ...observation, ...(season ? { season } : {}), provider, model, at };
}

export type EnrichResult =
  | { skipped: false; assetId: string; enrichment: MediaEnrichment }
  | { skipped: true; assetId: string; reason: string; error?: string };

function pickVisionProvider(env: NodeJS.ProcessEnv = process.env): "gemini" | "replicate" | null {
  if (env.GEMINI_API_KEY) return "gemini";
  if (env.REPLICATE_API_KEY) return "replicate";
  return null;
}

/**
 * Enrich one registered real-shop asset. Reads the row, makes ONE vision
 * call, merges `enrichment` into generation_params_json (other keys —
 * originalFilename, source — are preserved), and returns what happened.
 * Never throws: the caller is an upload path that must not fail because
 * cataloguing did.
 */
export async function enrichRealShopAsset(
  assetId: string,
  opts: { database?: DB; capturedAt?: Date; env?: NodeJS.ProcessEnv } = {},
): Promise<EnrichResult> {
  try {
    const database = opts.database ?? (await (await import("../db")).getDbTyped());
    if (!database) return { skipped: true, assetId, reason: "no_db" };
    const { mediaAssets } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await database
      .select({
        id: mediaAssets.id,
        runtimeUrl: mediaAssets.runtimeUrl,
        generationParamsJson: mediaAssets.generationParamsJson,
        createdAt: mediaAssets.createdAt,
        width: mediaAssets.width,
        height: mediaAssets.height,
      })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, assetId))
      .limit(1);
    if (!row) return { skipped: true, assetId, reason: "asset_not_found" };
    if (!row.runtimeUrl) return { skipped: true, assetId, reason: "no_runtime_url" };

    const provider = pickVisionProvider(opts.env);
    if (!provider) return { skipped: true, assetId, reason: "no_vision_key" };

    const { analyzePhoto } = await import("./vision-analyzer");
    // internal: operator-side enrichment is not the MMS pipeline the
    // photo_assess_enabled flag gates (see vision-analyzer AnalyzePhotoOptions).
    const res = await analyzePhoto({ photoUrl: row.runtimeUrl, prompt: buildEnrichmentPrompt(), provider, timeoutMs: 45_000, internal: true });
    if (!res.ok) return { skipped: true, assetId, reason: `vision_${res.reason}`, error: res.error };

    const observation = parseEnrichmentReply(res.description);
    if (!observation) return { skipped: true, assetId, reason: "unparseable_reply", error: res.description.slice(0, 200) };

    if (!observation.orientation && row.width && row.height) {
      observation.orientation = row.width === row.height ? "square" : row.width > row.height ? "landscape" : "portrait";
    }
    const enrichment: MediaEnrichment = {
      ...observation,
      season: seasonFor(opts.capturedAt ?? row.createdAt ?? new Date()),
      provider: res.source,
      model: res.modelName,
      at: new Date().toISOString(),
    };

    let existing: Record<string, unknown> = {};
    try {
      const parsed = row.generationParamsJson ? JSON.parse(row.generationParamsJson) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) existing = parsed as Record<string, unknown>;
    } catch { /* unreadable prior metadata is replaced, not propagated */ }
    await database
      .update(mediaAssets)
      .set({ generationParamsJson: JSON.stringify({ ...existing, enrichment }) })
      .where(eq(mediaAssets.id, assetId));
    log.info("real-shop asset enriched", { assetId, subject: enrichment.subject ?? null, service: enrichment.service ?? null, quality: enrichment.quality ?? null, provider: enrichment.provider });
    return { skipped: false, assetId, enrichment };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn("real-shop asset enrichment failed — asset stays registered, unenriched", { assetId, error });
    return { skipped: true, assetId, reason: "error", error };
  }
}
