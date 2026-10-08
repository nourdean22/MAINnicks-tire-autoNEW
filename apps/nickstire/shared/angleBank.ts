/**
 * Angle bank (2026-10-08) — the Reels Engine v2 strategic inventory as a
 * feasibility-graded INDEX over the committed Reel packs, validated in code.
 *
 * The data lives in docs/reels-engine-v2/angle-bank.json. This module owns
 * its shape and its two inventory rules (parseAngleBank: sequential ids and
 * ranks, status/pack agreement, production-ready confined to the first
 * PRODUCTION_READY_COUNT ranks, no category repeated inside a window of six
 * production-ready angles, no near-duplicate angles) and the one status line
 * the Creative Assistant renders (angleBankStatus + angleBankLine). Nothing
 * here reads a file or a database: the server reader hands in the facts —
 * which packs the production builder accepts, which are in the daily
 * rotation, which have published — so the same function is exact in a test
 * and in production.
 *
 * Rank order IS the production order. The first PRODUCTION_READY_COUNT angles
 * are the ones a brief, a route and a named real-evidence shot already exist
 * for; the first eight of those are the 8-Reel pilot. The daily lane reaches
 * an angle only through its pack: APPROVED_REEL_PACK_SLUGS in
 * server/services/approvedReelPackRotation.ts is the feed, append-only, on
 * operator instruction. `nextToApprove` names the production-ready packs that
 * are not in that array yet — a list for the operator, never an automatic
 * append.
 */
import type { TruthTopic } from "./mechanicalTruth";
import { ORIGINALITY_BLOCK_THRESHOLD, jaccardSimilarity, normalizeForComparison } from "./reelOriginality";

const ANGLE_CATEGORIES = [
  "tires-wear-age",
  "tires-puncture-damage",
  "tires-pressure-tpms",
  "tires-buying-fitment",
  "wheels-balance-alignment",
  "brakes",
  "suspension-steering",
  "battery-starting-charging",
  "check-engine-sensors",
  "cooling-heating-ac",
  "oil-fluids",
  "exhaust-emissions-echeck",
  "drivetrain-transmission",
  "electrical-body",
  "seasonal-cleveland-shop",
] as const;
export type AngleCategory = (typeof ANGLE_CATEGORIES)[number];

/** The eight content families of 03-FAMILIES-AND-STANDARD.md (A–D entry set, E–H deferred). */
export type AngleFamily = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";
/** The shot router's cheapest accepted method for the angle's evidence beats. */
export type AngleRoute = "real" | "real+deterministic" | "deterministic" | "still_motion" | "ai_illustrative+deterministic";
/** A = any week's jobs + a card · B = a specific job or scrap part · C = a rig or labelled illustrative shot · D = a truth packet or source first. */
export type AngleFeasibility = "A" | "B" | "C" | "D";
export type AngleStatus = "production_ready" | "pack_exists" | "stub";

export interface Angle {
  id: string;
  rank: number;
  title: string;
  question: string;
  category: AngleCategory;
  family: AngleFamily;
  route: AngleRoute;
  evidence: string;
  truthPacket: TruthTopic | null;
  feasibility: AngleFeasibility;
  /** The committed pack (docs/reel-packs/<slug>) that carries this angle's brief; null for a gap. */
  packSlug: string | null;
  status: AngleStatus;
}

export interface AngleBank {
  generated: string;
  note: string;
  categories: readonly AngleCategory[];
  angles: Angle[];
}

export const PRODUCTION_READY_COUNT = 20;
const PILOT_COUNT = 8;
/** No category repeats inside any window of this many consecutive production-ready angles. */
const CATEGORY_SPACING = 6;

const TRUTH_TOPICS: readonly TruthTopic[] = ["puncture_repair", "tread_depth", "uneven_wear", "vibration", "pothole_damage"];
const FAMILIES: readonly AngleFamily[] = ["A", "B", "C", "D", "E", "F", "G", "H"];
const ROUTES: readonly AngleRoute[] = ["real", "real+deterministic", "deterministic", "still_motion", "ai_illustrative+deterministic"];
const FEASIBILITIES: readonly AngleFeasibility[] = ["A", "B", "C", "D"];
const STATUSES: readonly AngleStatus[] = ["production_ready", "pack_exists", "stub"];
const PACK_SLUG = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/;

function fail(angle: string, problem: string): never {
  throw new Error(`angle bank: ${angle}: ${problem}`);
}

/** The dedupe key: title + question, normalised the way reelOriginality compares captions. */
function fingerprint(a: Pick<Angle, "title" | "question">): string {
  return normalizeForComparison(`${a.title} ${a.question}`);
}

/**
 * Validate the raw JSON into a bank, or throw naming the first defect. Every
 * rule here is one the production order depends on; the server reader calls
 * this on every Creative Assistant build, so a broken inventory file is an
 * error input on the Today tab, never a quietly shorter list.
 */
export function parseAngleBank(raw: unknown): AngleBank {
  if (!raw || typeof raw !== "object") throw new Error("angle bank: not an object");
  const r = raw as Record<string, unknown>;
  if (typeof r.generated !== "string" || typeof r.note !== "string") throw new Error("angle bank: generated/note missing");
  if (!Array.isArray(r.categories) || r.categories.length !== ANGLE_CATEGORIES.length || r.categories.some((c, i) => c !== ANGLE_CATEGORIES[i])) {
    throw new Error("angle bank: categories must list the fifteen known categories in order");
  }
  if (!Array.isArray(r.angles) || r.angles.length === 0) throw new Error("angle bank: angles missing");
  const angles: Angle[] = [];
  const seenPacks = new Set<string>();
  r.angles.forEach((item, i) => {
    const a = item as Record<string, unknown>;
    const label = typeof a.id === "string" ? a.id : `#${i + 1}`;
    const expectedId = `A${String(i + 1).padStart(3, "0")}`;
    if (a.id !== expectedId) fail(label, `id must be ${expectedId} (ids are sequential)`);
    if (a.rank !== i + 1) fail(label, `rank must be ${i + 1}`);
    for (const key of ["title", "question", "evidence"] as const) {
      if (typeof a[key] !== "string" || !(a[key] as string).trim()) fail(label, `${key} missing`);
    }
    if (!(ANGLE_CATEGORIES as readonly string[]).includes(a.category as string)) fail(label, `unknown category ${String(a.category)}`);
    if (!FAMILIES.includes(a.family as AngleFamily)) fail(label, `unknown family ${String(a.family)}`);
    if (!ROUTES.includes(a.route as AngleRoute)) fail(label, `unknown route ${String(a.route)}`);
    if (!FEASIBILITIES.includes(a.feasibility as AngleFeasibility)) fail(label, `unknown feasibility ${String(a.feasibility)}`);
    if (!STATUSES.includes(a.status as AngleStatus)) fail(label, `unknown status ${String(a.status)}`);
    if (a.truthPacket !== null && !TRUTH_TOPICS.includes(a.truthPacket as TruthTopic)) fail(label, `unknown truth packet ${String(a.truthPacket)}`);
    const packSlug = a.packSlug;
    if (packSlug !== null && (typeof packSlug !== "string" || !PACK_SLUG.test(packSlug))) fail(label, "packSlug must be null or a dated slug");
    if (a.status === "stub" && packSlug !== null) fail(label, "a stub cannot name a pack (it is one once it has a brief)");
    if (a.status !== "stub" && packSlug === null) fail(label, `status ${String(a.status)} needs a packSlug`);
    if (packSlug !== null) {
      if (seenPacks.has(packSlug)) fail(label, `pack ${packSlug} is already claimed by another angle`);
      seenPacks.add(packSlug);
    }
    const isTop = i < PRODUCTION_READY_COUNT;
    if (isTop && a.status !== "production_ready") fail(label, `rank ${i + 1} must be production_ready (the first ${PRODUCTION_READY_COUNT} are the production order)`);
    if (!isTop && a.status === "production_ready") fail(label, `production_ready is confined to the first ${PRODUCTION_READY_COUNT} ranks`);
    if (a.status === "production_ready" && a.feasibility !== "A" && a.feasibility !== "B") fail(label, "production_ready needs feasibility A or B");
    angles.push({
      id: a.id as string,
      rank: a.rank as number,
      title: a.title as string,
      question: a.question as string,
      category: a.category as AngleCategory,
      family: a.family as AngleFamily,
      route: a.route as AngleRoute,
      evidence: a.evidence as string,
      truthPacket: a.truthPacket as TruthTopic | null,
      feasibility: a.feasibility as AngleFeasibility,
      packSlug: packSlug as string | null,
      status: a.status as AngleStatus,
    });
  });

  // Production-order rule: inside any window of CATEGORY_SPACING consecutive
  // production-ready angles no category repeats, so the first week never posts
  // two tire-wear Reels and the hook-fatigue steer is not fighting the inventory.
  const top = angles.slice(0, PRODUCTION_READY_COUNT);
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < Math.min(top.length, i + CATEGORY_SPACING); j++) {
      if (top[i].category === top[j].category) {
        fail(top[j].id, `shares ${top[j].category} with ${top[i].id} only ${j - i} apart (minimum ${CATEGORY_SPACING} in the production order)`);
      }
    }
  }

  // No near-duplicate angles, by the same word-set rule the publish door uses
  // on captions: two angles that read as one are one slot spent twice.
  const prints = angles.map(fingerprint);
  for (let i = 0; i < prints.length; i++) {
    for (let j = i + 1; j < prints.length; j++) {
      const s = jaccardSimilarity(prints[i], prints[j]);
      if (s >= ORIGINALITY_BLOCK_THRESHOLD) fail(angles[j].id, `near-duplicate of ${angles[i].id} (word overlap ${s.toFixed(2)} ≥ ${ORIGINALITY_BLOCK_THRESHOLD})`);
    }
  }

  return { generated: r.generated, note: r.note, categories: ANGLE_CATEGORIES, angles };
}

/** The operator's active Reel slate, as the daily drain reads it (readActiveReelSlate). */
export interface AngleBankSlate {
  /** The slate's pack slugs; empty when the saved slate is unreadable. */
  slugs: ReadonlySet<string>;
  /** "active": the lane draws from it. "exhausted" (cursor past the last pack) and "unreadable": the lane holds. */
  state: "active" | "exhausted" | "unreadable";
}

export interface AngleBankFacts {
  /** Pack slugs the PRODUCTION builder accepts (packBuildsForLane) — the lane's own definition of usable. */
  buildablePacks: ReadonlySet<string>;
  /** APPROVED_REEL_PACK_SLUGS — approval into the daily lane's library. */
  rotation: ReadonlySet<string>;
  /**
   * The operator's active Reel slate, when one is set. The lane then draws ONLY
   * from it (resolveApprovedPackSelection), so "in rotation" means on the slate.
   * null or absent = no slate, the approved library is the rotation. The daily
   * drain HOLDS on an exhausted slate (cursor past its last pack) and on an
   * unreadable one, whose slug set is empty.
   */
  activeSlate?: AngleBankSlate | null;
  /** approvedPackSlug of every reel job that reached Instagram (posted or published). */
  publishedPackSlugs: ReadonlySet<string>;
}

export interface AngleBankStatus {
  total: number;
  productionReady: number;
  pilot: number;
  stubs: number;
  /** Production-ready angles whose pack the builder accepts. */
  withPack: number;
  /** Production-ready angles whose pack the lane can select today: the active slate's, else the approved library's. */
  inRotation: number;
  /** The operator's active slate as the lane sees it; null when none is set. */
  activeSlate: { size: number; state: AngleBankSlate["state"] } | null;
  /** Production-ready angles whose pack has been published at least once. */
  published: number;
  /** Production-ready pack slugs the builder accepts that are not in the approved library — the operator's list. */
  nextToApprove: string[];
  /** Production-ready pack slugs that are missing or that the builder rejects — a broken inventory entry. */
  missingPacks: string[];
}

export function angleBankStatus(bank: AngleBank, facts: AngleBankFacts): AngleBankStatus {
  const top = bank.angles.slice(0, PRODUCTION_READY_COUNT).filter((a) => a.status === "production_ready");
  const nextToApprove: string[] = [];
  const missingPacks: string[] = [];
  let withPack = 0;
  let inRotation = 0;
  let published = 0;
  for (const a of top) {
    const slug = a.packSlug;
    if (!slug || !facts.buildablePacks.has(slug)) {
      missingPacks.push(slug ?? a.id);
      continue;
    }
    withPack++;
    if ((facts.activeSlate ? facts.activeSlate.slugs : facts.rotation).has(slug)) inRotation++;
    if (!facts.rotation.has(slug)) nextToApprove.push(slug);
    if (facts.publishedPackSlugs.has(slug)) published++;
  }
  return {
    total: bank.angles.length,
    productionReady: top.length,
    pilot: Math.min(PILOT_COUNT, top.length),
    stubs: bank.angles.filter((a) => a.status === "stub").length,
    withPack,
    inRotation,
    activeSlate: facts.activeSlate ? { size: facts.activeSlate.slugs.size, state: facts.activeSlate.state } : null,
    published,
    nextToApprove,
    missingPacks,
  };
}

/**
 * One provenance line for the Creative Assistant's Sources row. A zero is
 * printed as a zero: "0 published" is the honest state of a bank whose packs
 * have not entered the rotation, and the operator reads it on a phone.
 */
export function angleBankLine(s: AngleBankStatus): string {
  const sl = s.activeSlate;
  const slate =
    !sl ? ""
    : sl.state === "unreadable" ? " (the active slate is unreadable, so the lane holds)"
    : sl.state === "exhausted" ? ` (active slate of ${sl.size}, used up, so the lane holds)`
    : ` (active slate of ${sl.size})`;
  const head = `${s.productionReady} production-ready angles of ${s.total}: ${s.withPack} with a pack, ${s.inRotation} in rotation${slate}, ${s.published} published`;
  const parts = [head];
  if (s.nextToApprove.length) parts.push(`awaiting rotation approval: ${s.nextToApprove.map(shortSlug).join(", ")}`);
  if (s.missingPacks.length) parts.push(`BROKEN entries (pack missing or rejected by the builder): ${s.missingPacks.join(", ")}`);
  return parts.join("; ");
}

function shortSlug(slug: string): string {
  return slug.replace(/^\d{4}-\d{2}-\d{2}-/, "");
}
