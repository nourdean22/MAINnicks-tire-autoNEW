/**
 * lib/services/brain-provenance.ts · Phase EE (2026-05-18 PM)
 *
 * Reverse search · given a chat message ID, returns the brain
 * memories MOST LIKELY to have shaped its generation, plus the
 * post-stream feedback artifacts (LLM-as-judge verdict + adversarial
 * objection). Powers the "brain context" section of MessageInfoCard
 * + the "why did Nick say that?" debugging surface.
 *
 * Extracted from `app/api/brain/provenance/[messageId]/route.ts` so
 * the legacy REST endpoint AND the new `trpc.chat.messageProvenance`
 * procedure both call this single function · drift impossible.
 * Same shared-service pattern as S.2 / U.3 / Y.1 / Z / DD.
 *
 * Edge cases:
 *   · message not found → ServiceError 404 (caller decides how to surface)
 *   · self-match hits (the reply's own nick_advice archive) filtered out
 *     so the top hit isn't always "this message itself"
 */

import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { recallMemoriesForQuery } from "@/lib/brain/memory-recall";
import { bdiTypeOf, bdiChainSummary, type BdiType } from "@/lib/brain/bdi";
import { coalaKindOf, type CoalaKind } from "@/lib/brain/coala";

export interface ProvenanceHit {
  memoryId: string;
  category: string;
  key: string;
  content: string;
  confidence: number;
  /** brain_memories.seen_count — the real sighting counter, carried via
   *  the `...h` spread so the trace modal can render honest attention
   *  ("seen N×") instead of inverting writer-stamped confidence. */
  seenCount: number;
  ageDays: number;
  /**
   * KNN cosine distance (0 = identical). Carried through verbatim
   * from `RecallHit` via the `...h` spread below — the interface
   * declares it so tRPC-inferred consumers (the ReasoningTraceModal's
   * `match %` readout) see the field the runtime already returns.
   */
  knnDistance: number;
  finalScore: number;
  bdi?: BdiType;
  coala?: CoalaKind;
}

export interface ProvenanceFeedback {
  judgment: {
    summary: string;
    rubric: unknown;
    composite: number | null;
    flagForReview: boolean;
    judgedAt: string;
  } | null;
  objection: {
    summary: string;
    severity: number;
    foundFlaw: boolean;
    raisedAt: string;
  } | null;
}

export interface ProvenanceResult {
  message: {
    id: string;
    role: string;
    contentPreview: string;
    createdAt: string;
    conversationId: string;
  };
  userContext: string | null;
  recall: {
    scanned: number;
    durationMs: number;
    selfMatchExcluded: number;
    hits: ProvenanceHit[];
    bdiChain: string;
    /**
     * 2026-08-19 · memory-loop wave · provenance honesty. "receipt" =
     * these hits are what ACTUALLY fired on the turn (persisted in the
     * message's tokenUsage.recall at stream time). "reconstruction" =
     * the message predates receipts, so recall was RE-RUN against the
     * reply text at read time — an approximation that can differ from
     * what the model really saw. The modal labels the two differently.
     */
    origin: "receipt" | "reconstruction";
  };
  feedback: ProvenanceFeedback;
}

export async function readMessageProvenance(args: {
  messageId: string;
}): Promise<ProvenanceResult> {
  const { messageId } = args;
  if (!messageId) throw new ServiceError("messageId required", 400);

  const msg = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      role: true,
      content: true,
      createdAt: true,
      conversationId: true,
      tokenUsage: true,
    },
  });
  if (!msg) throw new ServiceError(`Message not found: ${messageId}`, 404);

  // 2026-08-19 · memory-loop wave · RECEIPT-FIRST. If the turn persisted
  // its recall receipts (tokenUsage.recall), answer from what ACTUALLY
  // fired — hydrating fresh row state by id. The re-recall below becomes
  // the labeled fallback for pre-receipt messages, not the default: it
  // re-runs recall against the REPLY text at read time, which is a
  // reconstruction that can differ from what the model saw (and bumps
  // lastSeen as a side effect).
  const receipts = (
    (msg.tokenUsage as { recall?: unknown } | null)?.recall ?? []
  ) as Array<{
    id?: string;
    category?: string;
    key?: string;
    similarity?: number;
    seenCount?: number;
    snippet?: string;
  }>;
  const hasReceipts = Array.isArray(receipts) && receipts.length > 0;

  let trimmed: Array<{
    memoryId: string;
    category: string;
    key: string;
    content: string;
    confidence: number;
    seenCount: number;
    ageDays: number;
    knnDistance: number;
    finalScore: number;
  }>;
  let scanned: number;
  let selfMatchExcluded: number;
  let durationMs: number;
  const origin: "receipt" | "reconstruction" = hasReceipts ? "receipt" : "reconstruction";

  if (hasReceipts) {
    const t0 = Date.now();
    const ids = receipts.map((r) => String(r.id ?? "")).filter(Boolean);
    const rows = await prisma.brainMemory.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, category: true, key: true, content: true,
        confidence: true, seenCount: true, createdAt: true,
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    trimmed = receipts
      .filter((r) => r.id)
      .map((r) => {
        const live = byId.get(String(r.id));
        const similarity = typeof r.similarity === "number" ? r.similarity : 0;
        return {
          memoryId: String(r.id),
          category: live?.category ?? String(r.category ?? "unknown"),
          key: live?.key ?? String(r.key ?? ""),
          // Live content when the row still exists; the receipt snippet
          // when it was since deleted/merged — the receipt outlives the row.
          content: live?.content ?? `${String(r.snippet ?? "")} (row no longer live)`,
          confidence: live?.confidence ?? 0,
          seenCount: r.seenCount ?? live?.seenCount ?? 1,
          ageDays: live
            ? Math.floor((Date.now() - live.createdAt.getTime()) / 86_400_000)
            : 0,
          knnDistance: Math.max(0, Math.min(1, 1 - similarity)),
          finalScore: similarity,
        };
      });
    scanned = receipts.length;
    selfMatchExcluded = 0;
    durationMs = Date.now() - t0;
  } else {
    // v10.0.95 audit fix · self-match exclusion · every Nick reply is
    // auto-archived as a nick_advice memory keyed by msgId · pre-fix
    // the top hit was always the message's own archive. Pull wider +
    // filter self-match by key-containment so any future msgId-keyed
    // category gets caught too.
    const recall = await recallMemoriesForQuery(msg.content, { limit: 15 });
    const filteredHits = recall.hits.filter((h) => !h.key.includes(messageId));
    trimmed = filteredHits.slice(0, 10);
    scanned = recall.scanned;
    selfMatchExcluded = recall.hits.length - filteredHits.length;
    durationMs = recall.durationMs;
  }

  // Optionally pull the preceding user turn for assistant messages ·
  // Nick's reply was a function of the user message that preceded it.
  let userContext: string | null = null;
  if (msg.role === "assistant") {
    const prior = await prisma.chatMessage
      .findFirst({
        where: {
          conversationId: msg.conversationId,
          role: "user",
          createdAt: { lt: msg.createdAt },
        },
        orderBy: { createdAt: "desc" },
        select: { content: true },
      })
      .catch(() => null);
    userContext = prior?.content?.slice(0, 400) ?? null;
  }

  // v10.0.360 · BDI overlay · belief/desire/intention/observation
  // v10.0.367 · CoALA kind · semantic/episodic/procedural
  const annotatedHits: ProvenanceHit[] = trimmed.map((h) => ({
    ...h,
    bdi: bdiTypeOf({
      category: h.category,
      content: h.content,
      confidence: h.confidence,
    }) as BdiType,
    coala: coalaKindOf({ category: h.category }) as CoalaKind,
  }));

  // v10.0.384 · post-stream feedback artifacts (LLM-as-judge from
  // v10.0.366 + adversarial critic from v10.0.369) · both keyed by msgId.
  //
  // Phase EE fix · pre-fix the legacy route used inline category-string
  // literals (REPLY_JUDGMENT + ADVERSARIAL_OBJECTION) AND aliased
  // prisma as `db` · the BB codemod's safety filter (/prisma\.brainMemory/)
  // missed the file because it never saw the canonical name. EE.5
  // broadened the filter to /\b\w+\.brainMemory\b/ so any alias is
  // caught · this file is the first beneficiary.
  const [judgment, objection] = await Promise.all([
    prisma.brainMemory
      .findFirst({
        where: {
          category: BRAIN_CATEGORIES.REPLY_JUDGMENT,
          key: `judge_${messageId}`,
          deletedAt: null,
        },
        select: { content: true, metadata: true, createdAt: true },
      })
      .catch(() => null),
    prisma.brainMemory
      .findFirst({
        where: {
          category: BRAIN_CATEGORIES.ADVERSARIAL_OBJECTION,
          key: `objection_${messageId}`,
          deletedAt: null,
        },
        select: { content: true, metadata: true, createdAt: true },
      })
      .catch(() => null),
  ]);

  return {
    message: {
      id: msg.id,
      role: msg.role,
      contentPreview: msg.content.slice(0, 280),
      createdAt: msg.createdAt.toISOString(),
      conversationId: msg.conversationId,
    },
    userContext,
    recall: {
      scanned,
      durationMs,
      selfMatchExcluded,
      hits: annotatedHits,
      bdiChain: bdiChainSummary(trimmed),
      origin,
    },
    feedback: {
      judgment: judgment
        ? {
            summary: judgment.content,
            rubric:
              (judgment.metadata as { rubric?: unknown })?.rubric ?? null,
            composite:
              (judgment.metadata as { composite?: number })?.composite ?? null,
            flagForReview:
              (judgment.metadata as { flagForReview?: boolean })?.flagForReview ?? false,
            judgedAt: judgment.createdAt.toISOString(),
          }
        : null,
      objection: objection
        ? {
            summary: objection.content,
            severity:
              (objection.metadata as { severity?: number })?.severity ?? 1,
            foundFlaw:
              (objection.metadata as { foundFlaw?: boolean })?.foundFlaw ?? false,
            raisedAt: objection.createdAt.toISOString(),
          }
        : null,
    },
  };
}
