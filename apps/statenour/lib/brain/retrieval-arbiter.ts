/**
 * lib/brain/retrieval-arbiter.ts · 2026-09-08 (Brain plan §6.4, Wave 2)
 *
 * Two recall lanes fire on every chat turn and both feed the same prompt with
 * no cross-lane dedupe (lib/brain/lane-overlap.ts measures how much). This is
 * the PURE core of the arbiter: every lane's nominations in, ONE ordered
 * evidence pack with lane attribution out. No I/O, no prisma, no clock —
 * rerank and the validity filter belong to the caller (brain-context).
 *
 * Pipeline, in order:
 *   1. union by `id` — a row both lanes nominated is one item carrying both
 *      ranks; the same lane nominating an id twice keeps its best (lowest)
 *      rank; optional fields fill first-wins (a hybrid hit's `content` and a
 *      contextual row's `source` land on the same item).
 *   2. secondary dedupe by content identity (`normalizeContent`) — the first
 *      id seen wins, lanes/ranks union as in step 1. Items without content
 *      never merge here.
 *   3. RRF over lane ranks: rrf = Σ_lanes 1 / (k + rank + 1), ranks 0-based
 *      (identical to lib/brain/rrf.ts's 1-indexed 1/(k+rank); k=60 default).
 *   4. order: rrf desc → more lanes first → hybrid before contextual → id
 *      (code-unit order). Ties are compared exactly, no epsilon: e.g. ranks
 *      (61, 61) at k=60 sum to exactly 1/61, the same as a lone rank 0, and
 *      the lane-count rule then prefers the two-lane item.
 *   5. MMR-style redundancy cut: walk in that order and KEEP an item iff
 *      max(similarity(item, alreadyKept)) < 1 - redundancyPenalty. The max
 *      over an empty kept set is -Infinity, so the first item always
 *      survives; a non-finite similarity is ignored. Only KEPT items block
 *      later ones — a dropped near-duplicate does not.
 *   6. budgeted cut to `limit`.
 *
 * Garbage tolerance (never throws): a non-array input yields []; a candidate
 * is dropped when its `id` is not a non-empty string (contextual rows can
 * carry `id: ""`), its `lane` is unknown, or its `rank` is not a finite
 * number ≥ 0 (a NaN rank would silently poison the sort). An optional field
 * that is not a non-empty string counts as absent — contextual rows carry
 * `key: ""` for a keyless memory, and "" must not block the hybrid hit's real
 * key from filling in. Deterministic: insertion-ordered maps, a total order
 * in step 4, no randomness, and the input array is never mutated.
 */

export type Lane = "hybrid" | "contextual";

/** Canonical lane order — also the tie-break priority in step 4. */
const LANES: readonly Lane[] = ["hybrid", "contextual"];

const DEFAULT_K = 60;
const DEFAULT_LIMIT = 12;
const DEFAULT_REDUNDANCY_PENALTY = 0.35;

export interface ArbiterCandidate {
  id: string;
  key?: string;
  category?: string;
  source?: string;
  content?: string;
  lane: Lane;
  /** 0-based position within its own lane. */
  rank: number;
  /** The lane's own score. Accepted so callers can pass hits through unchanged; not used, not carried into EvidenceItem. */
  score?: number;
  /** contextual-recall's "direct" | "supporting" | "background". Accepted, not used, not carried into EvidenceItem. */
  relevance?: string;
}

export interface EvidenceItem {
  id: string;
  key?: string;
  category?: string;
  source?: string;
  content?: string;
  /** Every lane that nominated this item, in canonical order (hybrid, contextual). */
  lanes: Lane[];
  /** Best 0-based rank per nominating lane. */
  ranks: Partial<Record<Lane, number>>;
  rrf: number;
}

export interface ArbiterOptions {
  /** RRF constant · default 60. */
  k?: number;
  /** Pack size after the redundancy cut · default 12. */
  limit?: number;
  /** 0..1 · an item is dropped when its max similarity to a kept item is ≥ 1 - penalty · default 0.35. */
  redundancyPenalty?: number;
  /** Pairwise similarity in [0, 1] · default: Jaccard over lowercase word tokens of `content`, 0 when either content is missing. */
  similarity?: (a: EvidenceItem, b: EvidenceItem) => number;
}

/** The content-identity key: whitespace collapsed to single spaces, trimmed, lowercased. */
export function normalizeContent(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function wordTokens(content: string | undefined): Set<string> {
  if (!content) return new Set();
  return new Set(content.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

function jaccard(a: EvidenceItem, b: EvidenceItem): number {
  const ta = wordTokens(a.content);
  const tb = wordTokens(b.content);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

function isLane(x: unknown): x is Lane {
  return x === "hybrid" || x === "contextual";
}

/** Optional-field intake: present iff a non-empty string (contextual rows carry "" for absent). */
function str(x: unknown): string | undefined {
  return typeof x === "string" && x !== "" ? x : undefined;
}

function finiteOr(x: number | undefined, fallback: number): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}

/** One item under construction: identity + provenance + best rank per lane. */
interface Draft {
  id: string;
  key?: string;
  category?: string;
  source?: string;
  content?: string;
  ranks: Partial<Record<Lane, number>>;
}

/** Merge `from` into `into`: optional fields fill first-wins, ranks union by min per lane. */
function absorb(into: Draft, from: Draft): void {
  into.key ??= from.key;
  into.category ??= from.category;
  into.source ??= from.source;
  into.content ??= from.content;
  for (const lane of LANES) {
    const r = from.ranks[lane];
    if (r === undefined) continue;
    const cur = into.ranks[lane];
    into.ranks[lane] = cur === undefined ? r : Math.min(cur, r);
  }
}

function lanePriority(item: EvidenceItem): number {
  // `lanes` is non-empty and in canonical order, so its head is the highest-priority lane.
  return LANES.indexOf(item.lanes[0]);
}

function compareEvidence(a: EvidenceItem, b: EvidenceItem): number {
  if (a.rrf !== b.rrf) return b.rrf - a.rrf;
  if (a.lanes.length !== b.lanes.length) return b.lanes.length - a.lanes.length;
  const pa = lanePriority(a);
  const pb = lanePriority(b);
  if (pa !== pb) return pa - pb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function arbitrate(candidates: ArbiterCandidate[], opts: ArbiterOptions = {}): EvidenceItem[] {
  const k = Math.max(0, finiteOr(opts.k, DEFAULT_K));
  const limit = Math.max(0, Math.floor(finiteOr(opts.limit, DEFAULT_LIMIT)));
  const penalty = Math.min(1, Math.max(0, finiteOr(opts.redundancyPenalty, DEFAULT_REDUNDANCY_PENALTY)));
  const similarity = opts.similarity ?? jaccard;

  // 1. union by id (insertion order = first-seen order, which step 2 relies on)
  const byId = new Map<string, Draft>();
  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (!c || typeof c !== "object") continue;
    if (typeof c.id !== "string" || c.id === "") continue;
    if (!isLane(c.lane)) continue;
    if (typeof c.rank !== "number" || !Number.isFinite(c.rank) || c.rank < 0) continue;
    const draft: Draft = {
      id: c.id,
      key: str(c.key),
      category: str(c.category),
      source: str(c.source),
      content: str(c.content),
      ranks: { [c.lane]: c.rank },
    };
    const existing = byId.get(c.id);
    if (existing) absorb(existing, draft);
    else byId.set(c.id, draft);
  }

  // 2. secondary dedupe by content identity — first id wins
  const byContent = new Map<string, Draft>();
  const drafts: Draft[] = [];
  for (const d of byId.values()) {
    const identity = d.content === undefined ? "" : normalizeContent(d.content);
    const twin = identity === "" ? undefined : byContent.get(identity);
    if (twin) {
      absorb(twin, d);
      continue;
    }
    if (identity !== "") byContent.set(identity, d);
    drafts.push(d);
  }

  // 3. RRF, then 4. total order
  const items: EvidenceItem[] = drafts.map((d) => {
    const lanes: Lane[] = [];
    const ranks: Partial<Record<Lane, number>> = {};
    let rrf = 0;
    for (const lane of LANES) {
      const r = d.ranks[lane];
      if (r === undefined) continue;
      lanes.push(lane);
      ranks[lane] = r;
      rrf += 1 / (k + r + 1);
    }
    return { id: d.id, key: d.key, category: d.category, source: d.source, content: d.content, lanes, ranks, rrf };
  });
  items.sort(compareEvidence);

  // 5. greedy MMR against KEPT items only, 6. cut to limit
  const threshold = 1 - penalty;
  const kept: EvidenceItem[] = [];
  for (const item of items) {
    if (kept.length >= limit) break;
    let maxSim = -Infinity;
    for (const other of kept) {
      const s = similarity(item, other);
      if (Number.isFinite(s) && s > maxSim) maxSim = s;
    }
    if (maxSim < threshold) kept.push(item);
  }
  return kept;
}
