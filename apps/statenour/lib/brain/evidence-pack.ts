/**
 * lib/brain/evidence-pack.ts · 2026-09-08 (Brain plan, Wave 2 — the retrieval arbiter's I/O)
 *
 * Turns the two recall lanes' outputs into arbiter candidates and renders the
 * arbitrated pack as ONE fenced prompt block. Behind NICK_RECALL_ARBITER; when
 * the flag is off brain-context renders the two lanes separately as before.
 *
 * 2026-10-16 (W1): the pack now does what the flag text promised — a validity
 * filter over the candidates and ONE rerank over the arbitrated window — and
 * exposes the pieces brain-context and the eval runner need (the Context
 * Memories addendum split, the eval-lane mapping). `buildEvidencePack` stays
 * synchronous (identity rerank) for callers that have no query text;
 * `buildEvidencePackAsync` is the chat path.
 *
 * Pure except for the fence helper and the rerank call (string in, string out).
 */
import { arbitrate, type ArbiterCandidate, type EvidenceItem, type ArbiterOptions } from "@/lib/brain/retrieval-arbiter";
import { evidenceClassForSource } from "@/lib/brain/memory-commit-gateway";
import { fenceContent } from "@/lib/ai/tool-result-fencing";
import { rerank, isRerankAvailable } from "@/lib/brain/rerank";
import type { RetrievedMemory } from "@/lib/brain/recall-eval";

/**
 * Validity columns a candidate MAY carry. The hybrid lane filters all three in
 * SQL and the contextual lane applies validityWhere at fetch, so in production
 * this filter is defence in depth; a caller that passes unfiltered rows (an
 * eval lane, a fixture) gets the same rule. Mirrors contextual-recall's
 * isVisibleAsOf(row) in current mode, plus the 05-M5 probation expiry.
 */
export interface ValidityLike {
  validUntil?: Date | string | null;
  supersededById?: string | null;
  expiresAt?: Date | string | null;
}

export interface HybridHitLike extends ValidityLike {
  memoryId?: string;
  id?: string;
  key?: string;
  category?: string;
  source?: string;
  content?: string;
  confidence?: number;
  seenCount?: number;
}

export interface RankedRowLike extends ValidityLike {
  id: string;
  key?: string;
  category?: string;
  source?: string;
  content?: string;
  seenCount?: number;
  confidence?: number;
}

function pastOrAt(x: Date | string | null | undefined, now: number): boolean {
  if (x === null || x === undefined) return false;
  const t = x instanceof Date ? x.getTime() : new Date(x).getTime();
  return Number.isFinite(t) && t <= now;
}

export function isCandidateVisible(row: ValidityLike, now: Date = new Date()): boolean {
  if (row.supersededById) return false;
  const t = now.getTime();
  return !pastOrAt(row.validUntil, t) && !pastOrAt(row.expiresAt, t);
}

export function candidatesFromLanes(hybridHits: readonly HybridHitLike[], contextualRows: readonly RankedRowLike[]): ArbiterCandidate[] {
  const out: ArbiterCandidate[] = [];
  hybridHits.forEach((h, rank) => {
    const id = String(h.memoryId ?? h.id ?? "");
    if (!id) return;
    out.push({ id, key: h.key, category: h.category, source: h.source, content: h.content, lane: "hybrid", rank });
  });
  contextualRows.forEach((r, rank) => {
    if (!r.id) return;
    out.push({ id: String(r.id), key: r.key, category: r.category, source: r.source, content: r.content, lane: "contextual", rank });
  });
  return out;
}

const LABEL: Record<string, string> = {
  operator_stated: "you stated",
  system_receipt: "receipt",
  direct_observation: "observed",
  external_source: "external",
  supported_inference: "inferred",
  generated_summary: "summary",
  prediction: "prediction",
  weak_inference: "unclassified",
};

/** One line per item: lanes · evidence label · category · content (truncated by the lanes already). */
export function renderEvidencePack(items: readonly EvidenceItem[], opts?: { maxChars?: number }): string {
  if (items.length === 0) return "";
  const maxChars = opts?.maxChars ?? 2400;
  const lines: string[] = [`## Nick Brain — Evidence pack (${items.length}, one list across both recall lanes)`];
  let used = lines[0].length;
  for (const it of items) {
    const label = LABEL[evidenceClassForSource(it.source ?? "")] ?? "unclassified";
    const lanes = it.lanes.length === 2 ? "both lanes" : it.lanes[0] === "hybrid" ? "hybrid" : "contextual";
    const line = `- [${label} · ${it.category ?? "memory"} · ${lanes}] ${(it.content ?? "").replace(/\s+/g, " ").trim().slice(0, 220)}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return fenceContent("recallEvidencePack", "memory_recall", lines.join("\n"));
}

export type RerankBackend = "cohere" | "bge" | "none";

export interface EvidencePackResult {
  items: EvidenceItem[];
  block: string;
  /** Candidates offered to the arbiter AFTER the validity filter. */
  candidates: number;
  /** Which backend reordered the window; "none" = identity pass. */
  reranked: RerankBackend;
  /** Rows the validity filter removed before arbitration. */
  droppedValidity: number;
}

export interface EvidencePackOptions extends ArbiterOptions {
  maxChars?: number;
  /** The user turn; without it the rerank is skipped (identity). */
  query?: string;
  /** Clock for the validity filter · default now. */
  now?: Date;
  /** Wall-clock bound on the rerank call · default 1.5s, the contextual lane's RERANK_CALL_BUDGET_MS. */
  rerankBudgetMs?: number;
}

const DEFAULT_LIMIT = 12;
/** Cap on the rerank window: a cost cap on the call (24 short lines), not a tuned threshold. */
export const RERANK_WINDOW_MAX = 24;
const DEFAULT_RERANK_BUDGET_MS = 1_500;

function prepare(hybridHits: readonly HybridHitLike[], contextualRows: readonly RankedRowLike[], opts?: EvidencePackOptions) {
  const now = opts?.now ?? new Date();
  const hv = hybridHits.filter((h) => isCandidateVisible(h, now));
  const cv = contextualRows.filter((r) => isCandidateVisible(r, now));
  const droppedValidity = hybridHits.length - hv.length + (contextualRows.length - cv.length);
  const candidates = candidatesFromLanes(hv, cv);
  const limit = Math.max(1, opts?.limit ?? DEFAULT_LIMIT);
  return { candidates, droppedValidity, limit };
}

function finish(items: EvidenceItem[], candidates: number, droppedValidity: number, reranked: RerankBackend, opts?: EvidencePackOptions): EvidencePackResult {
  return { items, block: renderEvidencePack(items, { maxChars: opts?.maxChars }), candidates, reranked, droppedValidity };
}

/** Synchronous pack: validity filter + arbitrate, identity rerank. */
export function buildEvidencePack(
  hybridHits: readonly HybridHitLike[],
  contextualRows: readonly RankedRowLike[],
  opts?: EvidencePackOptions,
): EvidencePackResult {
  const { candidates, droppedValidity, limit } = prepare(hybridHits, contextualRows, opts);
  const items = arbitrate(candidates, { ...opts, limit });
  return finish(items, candidates.length, droppedValidity, "none", opts);
}

/** Resolves null past the budget or on a thrown backend; the caller keeps the identity order. */
function withBudget<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(null); });
  });
}

/**
 * The chat path: validity filter, arbitrate a window of min(limit*2, 24),
 * rerank that window ONCE when a backend is available, cut to `limit`. The
 * contextual lane already reranked its own top 25; this is the one cross-lane
 * pass the Wave 2 plan promised, over the fused list, so it can promote an
 * item the RRF cut would have dropped.
 */
export async function buildEvidencePackAsync(
  hybridHits: readonly HybridHitLike[],
  contextualRows: readonly RankedRowLike[],
  opts?: EvidencePackOptions,
): Promise<EvidencePackResult> {
  const { candidates, droppedValidity, limit } = prepare(hybridHits, contextualRows, opts);
  const window = Math.min(limit * 2, RERANK_WINDOW_MAX);
  let items = arbitrate(candidates, { ...opts, limit: window });
  let reranked: RerankBackend = "none";
  const query = opts?.query?.trim();
  if (query && items.length > 1 && isRerankAvailable()) {
    const res = await withBudget(
      rerank({
        query,
        candidates: items.map((it) => ({ item: it, text: `[${it.category ?? "memory"}] ${it.content ?? ""}`.slice(0, 1500) })),
        topN: items.length,
      }),
      opts?.rerankBudgetMs ?? DEFAULT_RERANK_BUDGET_MS,
    );
    if (res && res.length > 0) {
      reranked = res[0].source;
      const seen = new Set(res.map((r) => r.item.id));
      // A backend that returns fewer than topN keeps the rest in identity order behind the winners.
      items = [...res.map((r) => r.item), ...items.filter((it) => !seen.has(it.id))];
    }
  }
  return finish(items.slice(0, limit), candidates.length, droppedValidity, reranked, opts);
}

/** The sections of a Context Memories block that are NOT the memory list (contextual-recall.ts appends them after it, in this order). */
const ADDENDUM_MARKERS = [
  "### Connected (linked in your brain graph)",
  "### Deeper Context",
  "### Related Commitments",
  "### Related Active Tasks",
  "### Related People",
] as const;

/**
 * W1 · when the arbiter is on, the pack carries the memory list, but the
 * contextual lane's graph (1-hop MemoryEdge), cross-source and related lines
 * exist only inside its rendered block. Return that block reduced to those
 * sections — heading and fence kept, memory list dropped — or "" when the
 * block has none, so brain-context adds a block instead of deleting them.
 */
export function extractRecallAddendum(contextMemories: string): string {
  if (!contextMemories) return "";
  const open = contextMemories.match(/<tool_data tool="[^"]+" source="memory_recall">\n?/);
  if (!open || open.index === undefined) return "";
  const bodyStart = open.index + open[0].length;
  let first = -1;
  for (const m of ADDENDUM_MARKERS) {
    const i = contextMemories.indexOf(m, bodyStart);
    if (i >= 0 && (first < 0 || i < first)) first = i;
  }
  if (first < 0) return "";
  return contextMemories.slice(0, bodyStart) + contextMemories.slice(first);
}

/** scripts/recall-eval.ts `arbiter` lane: pack order as the runner's keyed rows; a keyless item cannot be scored. */
export function toRetrievedMemories(items: readonly EvidenceItem[]): RetrievedMemory[] {
  return items.filter((it): it is EvidenceItem & { key: string } => !!it.key).map((it) => ({ key: it.key, score: it.rrf }));
}
