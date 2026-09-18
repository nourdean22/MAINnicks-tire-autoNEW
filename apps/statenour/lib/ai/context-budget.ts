/**
 * lib/ai/context-budget.ts · 2026-09-17 (Brain plan §6.5, Wave 3 — context receipt)
 *
 * `rerankContextBlocks` (lib/ai/context-reranker.ts) cuts blocks on a single
 * cosine threshold (0.12) with no notion of TOKEN COST and no record of WHY a
 * block survived or was cut. `trimPromptToBudget` (lib/ai/system-prompt.ts)
 * separately trims the assembled PROMPT STRING by section priority, later,
 * with no visibility into the first cut. Neither can answer "why was this in
 * front of the model, and at what token cost" — the question the Sept-8 brain
 * plan's §6.5 context receipt exists to answer.
 *
 * This is that receipt. Pure — no I/O, no clock, no prisma — mirroring
 * lib/brain/retrieval-arbiter.ts's contract deliberately: deterministic,
 * garbage-tolerant, the caller supplies any embeddings/similarity fn it wants.
 *
 * SHIPPED AS OBSERVABILITY ONLY. It explains the existing threshold cut in
 * token terms and additionally computes what a token-budget + MMR pass WOULD
 * drop, but nothing today drops content on its say-so — `addendum` in
 * brain-context.ts is unchanged by this module. Wave 0's lane-overlap
 * instrument shipped the same way: measure before changing behavior. See the
 * doc's §6.5 for the follow-up (actually gating `addendum` on this receipt,
 * behind a flag, once a turn's worth of receipts shows the budget cut is
 * sane).
 */

export interface ContextBudgetBlock {
  name: string;
  content: string;
  /** Cosine similarity to the user turn, as computed by rerankContextBlocks. */
  similarity: number;
  /** Whether rerankContextBlocks's 0.12 threshold already kept this block. */
  kept: boolean;
  critical?: boolean;
}

export type ContextReceiptReason =
  | "critical" // force-kept regardless of budget or redundancy
  | "fits_budget" // non-critical, passed the threshold, fit inside the token budget, not redundant
  | "below_threshold" // the EXISTING reranker cut already dropped this one
  | "over_budget" // passed the threshold, but the greedy budget fill ran out of room
  | "redundant"; // passed threshold + budget order, but too similar to an already-kept block

export interface ContextReceiptEntry {
  name: string;
  tokens: number;
  similarity: number;
  critical: boolean;
  kept: boolean;
  reason: ContextReceiptReason;
}

export interface ContextReceipt {
  entries: ContextReceiptEntry[];
  tokensBudget: number;
  /** Sum of tokens for entries this receipt marks kept (includes critical). */
  tokensKept: number;
  /** Sum of tokens for entries this receipt marks dropped, for any reason. */
  tokensDropped: number;
  droppedCount: number;
  /**
   * 2026-09-17 · the point-in-time filter recall ran under, ISO, or absent for
   * "current". This is here because of a defect the same PR fixed: a false
   * `asOf` from the query planner made recall answer as of a past instant and
   * there was NO signal anywhere that it had happened — validityWhere(asOf)
   * degrades to `createdAt <= asOf` for every row without validFrom (all
   * 40,889 of them as of the 2026-09-08 probe), so the turn silently answered
   * from a fraction of the brain.
   *
   * Fixing the classifier removed today's trigger; recording the instant here
   * removes the SILENCE, which is the part that made it survive. A stored ISO
   * string, not a Date: this object round-trips through a Prisma Json column.
   */
  recallAsOf?: string;
}

/**
 * chars/4 — a coarse, documented approximation. No tokenizer dependency for
 * an observability-only receipt; if this module starts gating real content,
 * swap in a real tokenizer first (see file header).
 */
export function estimateTokens(content: string): number {
  if (!content) return 0;
  return Math.ceil(content.length / 4);
}

const DEFAULT_REDUNDANCY_PENALTY = 0.15;

/**
 * Observability default, NOT calibrated against real turns yet. Chosen as
 * roughly half of `trimPromptToBudget`'s 58,000-char whole-prompt ceiling
 * (lib/ai/system-prompt.ts), leaving room for identity/task/tool sections
 * outside the brain-block addendum this receipt measures. Revisit once a
 * turn's worth of receipts shows what the blocks actually cost.
 */
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 7250; // ~29,000 chars at the chars/4 estimate

/**
 * Build a context receipt over blocks rerankContextBlocks already scored.
 *
 * Never throws on garbage input: a non-array `blocks` yields an empty
 * receipt; a block with a non-finite `similarity` is treated as 0; empty
 * `content` costs 0 tokens.
 *
 * `similarityFn`, if supplied, scores block-to-block redundancy for an
 * MMR-style pass (mirrors retrieval-arbiter.ts's injected-similarity
 * contract exactly). Omitted, redundancy is skipped and every
 * threshold-survivor is budget-ranked only.
 */
export function buildContextReceipt(
  blocks: ContextBudgetBlock[],
  tokensBudget: number,
  options: {
    redundancyPenalty?: number;
    similarityFn?: (a: string, b: string) => number;
    /** The point-in-time filter recall ran under; omitted/invalid = current. */
    asOf?: Date | null;
  } = {},
): ContextReceipt {
  // A Date that is not a Date, or an Invalid Date, must not become the string
  // "Invalid Date" in a persisted receipt — it reads as a real filter.
  const asOfIso =
    options.asOf instanceof Date && Number.isFinite(options.asOf.getTime())
      ? options.asOf.toISOString()
      : undefined;
  if (!Array.isArray(blocks)) {
    return {
      entries: [],
      tokensBudget,
      tokensKept: 0,
      tokensDropped: 0,
      droppedCount: 0,
      ...(asOfIso ? { recallAsOf: asOfIso } : {}),
    };
  }
  const { redundancyPenalty = DEFAULT_REDUNDANCY_PENALTY, similarityFn } = options;
  const budget = Number.isFinite(tokensBudget) && tokensBudget >= 0 ? tokensBudget : 0;

  const scored = blocks.map((b) => ({
    name: String(b?.name ?? ""),
    content: typeof b?.content === "string" ? b.content : "",
    tokens: estimateTokens(typeof b?.content === "string" ? b.content : ""),
    similarity: Number.isFinite(b?.similarity) ? (b.similarity as number) : 0,
    critical: !!b?.critical,
    kept: !!b?.kept,
  }));

  const entries: ContextReceiptEntry[] = [];

  // Blocks the EXISTING threshold cut already dropped never enter the
  // budget/redundancy pass — their reason is fixed, not computed.
  for (const s of scored) {
    if (!s.kept) {
      entries.push({ name: s.name, tokens: s.tokens, similarity: s.similarity, critical: s.critical, kept: false, reason: "below_threshold" });
    }
  }

  // Threshold survivors: critical first (order among criticals doesn't
  // matter — none of them can be dropped), then descending utility =
  // similarity / max(tokens, 1) so a short, on-topic block beats a long,
  // barely-relevant one for the same similarity score.
  const survivors = scored.filter((s) => s.kept);
  const ranked = [...survivors].sort((a, b) => {
    if (a.critical !== b.critical) return a.critical ? -1 : 1;
    const uA = a.similarity / Math.max(a.tokens, 1);
    const uB = b.similarity / Math.max(b.tokens, 1);
    return uB - uA;
  });

  const keptContent: string[] = [];
  let spent = 0;

  for (const s of ranked) {
    if (s.critical) {
      entries.push({ name: s.name, tokens: s.tokens, similarity: s.similarity, critical: true, kept: true, reason: "critical" });
      spent += s.tokens;
      keptContent.push(s.content);
      continue;
    }
    if (similarityFn && keptContent.some((k) => {
      const sim = similarityFn(s.content, k);
      return Number.isFinite(sim) && sim >= 1 - redundancyPenalty;
    })) {
      entries.push({ name: s.name, tokens: s.tokens, similarity: s.similarity, critical: false, kept: false, reason: "redundant" });
      continue;
    }
    if (spent + s.tokens > budget) {
      entries.push({ name: s.name, tokens: s.tokens, similarity: s.similarity, critical: false, kept: false, reason: "over_budget" });
      continue;
    }
    entries.push({ name: s.name, tokens: s.tokens, similarity: s.similarity, critical: false, kept: true, reason: "fits_budget" });
    spent += s.tokens;
    keptContent.push(s.content);
  }

  const tokensKept = entries.filter((e) => e.kept).reduce((sum, e) => sum + e.tokens, 0);
  const tokensDropped = entries.filter((e) => !e.kept).reduce((sum, e) => sum + e.tokens, 0);

  return {
    entries,
    tokensBudget: budget,
    tokensKept,
    tokensDropped,
    droppedCount: entries.filter((e) => !e.kept).length,
    ...(asOfIso ? { recallAsOf: asOfIso } : {}),
  };
}
