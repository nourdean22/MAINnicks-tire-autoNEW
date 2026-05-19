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
  ageDays: number;
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
    },
  });
  if (!msg) throw new ServiceError(`Message not found: ${messageId}`, 404);

  // v10.0.95 audit fix · self-match exclusion · every Nick reply is
  // auto-archived as a nick_advice memory keyed by msgId · pre-fix
  // the top hit was always the message's own archive. Pull wider +
  // filter self-match by key-containment so any future msgId-keyed
  // category gets caught too.
  const recall = await recallMemoriesForQuery(msg.content, { limit: 15 });
  const filteredHits = recall.hits.filter((h) => !h.key.includes(messageId));
  const trimmed = filteredHits.slice(0, 10);

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
      scanned: recall.scanned,
      durationMs: recall.durationMs,
      selfMatchExcluded: recall.hits.length - filteredHits.length,
      hits: annotatedHits,
      bdiChain: bdiChainSummary(trimmed),
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
