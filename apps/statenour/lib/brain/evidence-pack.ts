/**
 * lib/brain/evidence-pack.ts · 2026-09-08 (Brain plan, Wave 2 — the retrieval arbiter's I/O)
 *
 * Turns the two recall lanes' outputs into arbiter candidates and renders the
 * arbitrated pack as ONE fenced prompt block. Behind NICK_RECALL_ARBITER; when
 * the flag is off brain-context renders the two lanes separately as before.
 *
 * 2026-10-16 (W1 + review rounds 1-2): the pack now does what the flag text
 * promised — a validity filter over the candidates (measured only when the
 * rows carry the columns; otherwise UNMEASURED, never a clean 0) and ONE
 * rerank over the arbitrated window, under the same threshold the contextual
 * lane uses — renders every item through the lanes' per-row trust rule, and
 * exposes the pieces brain-context and the eval runner need (the Context
 * Memories addendum split, the eval-lane mapping). `buildEvidencePack` stays
 * synchronous (identity rerank) for callers that have no query text;
 * `buildEvidencePackAsync` is the chat path.
 *
 * Pure except for the fence helpers and the rerank call (string in, string out).
 */
import { arbitrate, type ArbiterCandidate, type EvidenceItem, type ArbiterOptions } from "@/lib/brain/retrieval-arbiter";
import { evidenceClassForSource } from "@/lib/brain/memory-commit-gateway";
import { fenceContent } from "@/lib/ai/tool-result-fencing";
import { rerank, isRerankAvailable } from "@/lib/brain/rerank";
import { classifyTrustTier, canRenderAsKnowledge, fenceUntrustedMemory, type TrustTier } from "@/lib/brain/memory-trust";
import { RECALL_ADDENDUM_HEADINGS } from "@/lib/brain/contextual-recall";
import type { RetrievedMemory } from "@/lib/brain/recall-eval";

/**
 * Validity columns a candidate MAY carry. Both lanes filter them in SQL /
 * validityWhere at fetch, so in production this filter is defence in depth;
 * the point of carrying them (memory-recall.ts RecallHit, contextual-recall.ts
 * RankedRecallRow) is that the pack can tell "filter ran, nothing to drop"
 * from "rows carried no validity at all". A value of `undefined` means the
 * row never carried the column; `null` means the column is empty.
 */
export interface ValidityLike {
  validUntil?: Date | string | null;
  supersededById?: string | null;
  expiresAt?: Date | string | null;
  /** PR #3088 CX-3 · the start bound (validFrom ?? createdAt), checked in as-of mode only. */
  validFrom?: Date | string | null;
  createdAt?: Date | string | null;
}

/**
 * PR #3088 CX-2 · per chat mode: the contextual lane's limit, memory-recall's
 * limit and the pack limit brain-context passes. scripts/recall-eval.ts reads
 * this same table, so the eval's arbiter lane cannot drift from production.
 */
export const RECALL_MODE_LIMITS = {
  standard: { contextual: 5, memoryRecall: 5, pack: 10 },
  deep: { contextual: 10, memoryRecall: 8, pack: 14 },
} as const;
export type RecallModeLimits = (typeof RECALL_MODE_LIMITS)[keyof typeof RECALL_MODE_LIMITS];

export interface HybridHitLike extends ValidityLike {
  memoryId?: string;
  id?: string;
  key?: string;
  category?: string;
  source?: string;
  content?: string;
  confidence?: number;
  seenCount?: number;
  /** memory-recall.ts stamps the resolved tier; absent = re-derive from source + category. */
  trustTier?: TrustTier;
}

export interface RankedRowLike extends ValidityLike {
  id: string;
  key?: string;
  category?: string;
  source?: string;
  content?: string;
  seenCount?: number;
  confidence?: number;
  trustTier?: TrustTier;
}

function pastOrAt(x: Date | string | null | undefined, t: number): boolean {
  if (x === null || x === undefined) return false;
  const v = x instanceof Date ? x.getTime() : new Date(x).getTime();
  return Number.isFinite(v) && v <= t;
}

/** In as-of mode the start bound is part of the filter, so a row without validFrom or createdAt is not measured. */
export function hasValidityFields(row: ValidityLike, asOf?: Date | null): boolean {
  const end = row.validUntil !== undefined || row.supersededById !== undefined || row.expiresAt !== undefined;
  return asOf ? end && (row.validFrom ?? row.createdAt) != null : end;
}

/**
 * contextual-recall's isVisibleAsOf(row, asOf) semantics: in current mode a
 * superseded row or one whose validity ended is hidden; in as-of mode the row
 * must have started by asOf (validFrom, else createdAt) and not ended (a
 * superseded belief was still the belief back then). The start bound is checked
 * here, not trusted to the lanes: memory-recall fetches at current time
 * (PR #3088 CX-3). The 05-M5 probation expiry is a wall-clock fact in both modes.
 */
export function isCandidateVisible(row: ValidityLike, asOf?: Date | null, now: Date = new Date()): boolean {
  if (pastOrAt(row.expiresAt, now.getTime())) return false;
  if (!asOf) {
    if (row.supersededById) return false;
    return !pastOrAt(row.validUntil, now.getTime());
  }
  const start = row.validFrom ?? row.createdAt;
  const startMs = start == null ? NaN : new Date(start).getTime();
  if (Number.isFinite(startMs) && startMs > asOf.getTime()) return false;
  return !pastOrAt(row.validUntil, asOf.getTime());
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

/** The lanes' per-row rule (memory-recall.ts formatRecallForPrompt, contextual-recall.ts renderMemoryLine): a missing tier re-derives, never fails closed. */
function tierOf(it: { trustTier?: string; source?: string; category?: string }): TrustTier {
  return (it.trustTier as TrustTier | undefined) ?? classifyTrustTier(it.source || "unclassified", null, it.category ?? "");
}

/** One line per item: lanes · evidence label · category · content (truncated by the lanes already), third-party rows fenced. */
export function renderEvidencePack(items: readonly EvidenceItem[], opts?: { maxChars?: number }): string {
  if (items.length === 0) return "";
  const maxChars = opts?.maxChars ?? 2400;
  const lines: string[] = [`## Nick Brain — Evidence pack (${items.length}, one list across both recall lanes)`];
  let used = lines[0].length;
  for (const it of items) {
    const label = LABEL[evidenceClassForSource(it.source ?? "")] ?? "unclassified";
    const lanes = it.lanes.length === 2 ? "both lanes" : it.lanes[0] === "hybrid" ? "hybrid" : "contextual";
    const body = (it.content ?? "").replace(/\s+/g, " ").trim().slice(0, 220);
    const tier = tierOf(it);
    const line = `- [${label} · ${it.category ?? "memory"} · ${lanes}] ${canRenderAsKnowledge(tier) ? body : fenceUntrustedMemory(body, tier)}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return fenceContent("recallEvidencePack", "memory_recall", lines.join("\n"));
}

export type RerankBackend = "cohere" | "bge" | "none";
/** Why the pack is in the order it is: the backend that reranked it, or which identity branch fired. */
export type RerankReason = "cohere" | "bge" | "none_no_query" | "none_below_threshold" | "none_no_backend" | "none_timeout" | "none_error" | "none_empty";

export interface EvidencePackResult {
  items: EvidenceItem[];
  block: string;
  /** Candidates offered to the arbiter AFTER the validity filter. */
  candidates: number;
  /** Which backend reordered the window; "none" = identity pass (see rerankReason). */
  reranked: RerankBackend;
  rerankReason: RerankReason;
  /** Rows the validity filter removed; null = UNMEASURED (no candidate carried a validity column). */
  droppedValidity: number | null;
}

export interface EvidencePackOptions extends ArbiterOptions {
  maxChars?: number;
  /** The recall text (referent-aware, as the contextual lane uses); without it the rerank is skipped. */
  query?: string;
  /** The turn's point-in-time filter; null/undefined = current. */
  asOf?: Date | null;
  /** Clock for the validity filter · default now. */
  now?: Date;
  /** Wall-clock bound on the rerank call · default 1.5s, the contextual lane's RERANK_CALL_BUDGET_MS. */
  rerankBudgetMs?: number;
}

const DEFAULT_LIMIT = 12;
/** Cap on the rerank window: a cost cap on the call (24 short lines), not a tuned threshold. */
export const RERANK_WINDOW_MAX = 24;
/** Same bar as the contextual lane (contextual-recall.ts: `isRerankAvailable() && scored.length > 5`). */
export const RERANK_MIN_ITEMS = 5;
/** The query sent to the hosted reranker is capped; the lanes already matched on the full text. */
export const RERANK_QUERY_MAX_CHARS = 500;
const DEFAULT_RERANK_BUDGET_MS = 1_500;

function prepare(hybridHits: readonly HybridHitLike[], contextualRows: readonly RankedRowLike[], opts?: EvidencePackOptions) {
  const now = opts?.now ?? new Date();
  const asOf = opts?.asOf ?? null;
  const measured = hybridHits.some((h) => hasValidityFields(h, asOf)) || contextualRows.some((r) => hasValidityFields(r, asOf));
  const hv = hybridHits.filter((h) => isCandidateVisible(h, asOf, now));
  const cv = contextualRows.filter((r) => isCandidateVisible(r, asOf, now));
  const droppedValidity = measured ? hybridHits.length - hv.length + (contextualRows.length - cv.length) : null;
  const candidates = candidatesFromLanes(hv, cv);
  // Least-trusted tier per id wins, so a row either lane fenced stays fenced after the union.
  const tierById = new Map<string, TrustTier>();
  for (const row of [...hv, ...cv]) {
    const id = String((row as HybridHitLike).memoryId ?? row.id ?? "");
    if (!id) continue;
    const tier = tierOf(row);
    const prev = tierById.get(id);
    if (!prev || (canRenderAsKnowledge(prev) && !canRenderAsKnowledge(tier))) tierById.set(id, tier);
  }
  const limit = Math.max(1, opts?.limit ?? DEFAULT_LIMIT);
  const withTier = (items: EvidenceItem[]): EvidenceItem[] => items.map((it) => ({ ...it, trustTier: tierById.get(it.id) }));
  return { candidates, droppedValidity, limit, withTier };
}

function finish(items: EvidenceItem[], candidates: number, droppedValidity: number | null, rerankReason: RerankReason, opts?: EvidencePackOptions): EvidencePackResult {
  const reranked: RerankBackend = rerankReason === "cohere" || rerankReason === "bge" ? rerankReason : "none";
  return { items, block: renderEvidencePack(items, { maxChars: opts?.maxChars }), candidates, reranked, rerankReason, droppedValidity };
}

/** Synchronous pack: validity filter + arbitrate, identity rerank. */
export function buildEvidencePack(
  hybridHits: readonly HybridHitLike[],
  contextualRows: readonly RankedRowLike[],
  opts?: EvidencePackOptions,
): EvidencePackResult {
  const { candidates, droppedValidity, limit, withTier } = prepare(hybridHits, contextualRows, opts);
  const items = withTier(arbitrate(candidates, { ...opts, limit }));
  return finish(items, candidates.length, droppedValidity, "none_no_query", opts);
}

type Budgeted<T> = { kind: "ok"; value: T | null } | { kind: "timeout" } | { kind: "error" };

/** Distinguishes the budget expiring from the backend throwing from a null answer; the caller keeps the identity order on all three. */
function withBudget<T>(p: Promise<T | null>, ms: number): Promise<Budgeted<T>> {
  return new Promise<Budgeted<T>>((resolve) => {
    const timer = setTimeout(() => resolve({ kind: "timeout" }), ms);
    p.then(
      (value) => { clearTimeout(timer); resolve({ kind: "ok", value }); },
      () => { clearTimeout(timer); resolve({ kind: "error" }); },
    );
  });
}

/**
 * The chat path: validity filter, arbitrate a window of min(limit*2, 24),
 * rerank that window ONCE when a backend is available and the window is above
 * the contextual lane's threshold, cut to `limit`. The contextual lane already
 * reranked its own top 25; this is the one cross-lane pass the Wave 2 plan
 * promised, over the fused list, so it can promote an item the RRF cut would
 * have dropped. Worst case it adds `rerankBudgetMs` (1.5s) after the lanes'
 * own 3s races.
 */
export async function buildEvidencePackAsync(
  hybridHits: readonly HybridHitLike[],
  contextualRows: readonly RankedRowLike[],
  opts?: EvidencePackOptions,
): Promise<EvidencePackResult> {
  const { candidates, droppedValidity, limit, withTier } = prepare(hybridHits, contextualRows, opts);
  const window = Math.min(limit * 2, RERANK_WINDOW_MAX);
  let items = withTier(arbitrate(candidates, { ...opts, limit: window }));
  const query = opts?.query?.trim().slice(0, RERANK_QUERY_MAX_CHARS);
  let reason: RerankReason;
  if (!query) reason = "none_no_query";
  else if (items.length <= RERANK_MIN_ITEMS) reason = "none_below_threshold";
  else if (!isRerankAvailable()) reason = "none_no_backend";
  else {
    const res = await withBudget(
      rerank({
        query,
        candidates: items.map((it) => ({ item: it, text: `[${it.category ?? "memory"}] ${it.content ?? ""}`.slice(0, 1500) })),
        topN: items.length,
      }),
      opts?.rerankBudgetMs ?? DEFAULT_RERANK_BUDGET_MS,
    );
    if (res.kind !== "ok") reason = res.kind === "timeout" ? "none_timeout" : "none_error";
    else if (!res.value || res.value.length === 0) reason = "none_empty";
    else {
      reason = res.value[0].source === "bge" ? "bge" : "cohere";
      const seen = new Set(res.value.map((r) => r.item.id));
      // A backend that returns fewer than topN keeps the rest in fused order behind the winners.
      items = [...res.value.map((r) => r.item), ...items.filter((it) => !seen.has(it.id))];
    }
  }
  return finish(items.slice(0, limit), candidates.length, droppedValidity, reason, opts);
}

/** First occurrence of `needle` at a LINE START at or after `from`, or -1. */
function indexAtLineStart(haystack: string, needle: string, from: number): number {
  let i = haystack.indexOf(needle, from);
  while (i >= 0 && i > 0 && haystack[i - 1] !== "\n") i = haystack.indexOf(needle, i + 1);
  return i;
}

/**
 * W1 · when the arbiter is on, the pack carries the memory list, but the
 * contextual lane's graph (1-hop MemoryEdge), cross-source and related lines
 * exist only inside its rendered block. Return that block reduced to those
 * sections — heading, fence and fenceContent's injection annotation kept,
 * memory list dropped — or "" when the block has none, so brain-context adds
 * a block instead of deleting them. The fence is located AFTER the heading
 * line (the heading quotes user text) and the section markers must sit at a
 * line start (a heading quoted inside a memory body is not a section).
 */
export function extractRecallAddendum(contextMemories: string): string {
  if (!contextMemories) return "";
  const headingEnd = contextMemories.indexOf("\n");
  if (headingEnd < 0) return "";
  const openRe = /<tool_data tool="[^"]+" source="memory_recall">\n?/g;
  openRe.lastIndex = headingEnd;
  const open = openRe.exec(contextMemories);
  if (!open) return "";
  let bodyStart = open.index + open[0].length;
  const annotation = /^<!-- injection_flags:[^\n]*-->\n?/.exec(contextMemories.slice(bodyStart));
  if (annotation) bodyStart += annotation[0].length;
  let first = -1;
  for (const marker of Object.values(RECALL_ADDENDUM_HEADINGS)) {
    const i = indexAtLineStart(contextMemories, marker, bodyStart);
    if (i >= 0 && (first < 0 || i < first)) first = i;
  }
  if (first < 0) return "";
  return contextMemories.slice(0, bodyStart) + contextMemories.slice(first);
}

/** scripts/recall-eval.ts `arbiter` lane: pack order as the runner's keyed rows; a keyless item cannot be scored. */
export function toRetrievedMemories(items: readonly EvidenceItem[]): RetrievedMemory[] {
  return items.filter((it): it is EvidenceItem & { key: string } => !!it.key).map((it) => ({ key: it.key, score: it.rrf }));
}
