/**
 * Derive the structured journal silos from the dumps the operator already writes.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS — THE MEASUREMENT, NOT THE INTUITION
 * ════════════════════════════════════════════════════════════════════════════
 * Measured on prod 2026-09-18:
 *
 *     silo                rows   newest       last 30d
 *     brain_dumps         1450   2026-09-17        162
 *     reflections          217   2026-06-17          0
 *     situation_logs         0   never               0
 *     decision_replays       9   2026-03-28          0
 *
 * The obvious reading — "the operator stopped journaling, retire the silos" —
 * is WRONG. He journals 162 times a month, daily, via `/dump` in Telegram. The
 * three structured silos are a UI-era artifact that was never adopted, because
 * they live on a page a phone-first operator does not open.
 *
 * ⚠ AND DISCOVERABILITY WAS ALREADY SOLVED, TWICE. `/journal` is in the nav
 * spine, the page mounts `ReflectComposer`, and components/journal/todays-prompt.tsx
 * (2026-05-28) ships a curated daily question with a 1-tap answer — built for
 * exactly the "blank composer" problem. It shipped 2026-05-28; reflections died
 * 2026-06-17, three weeks later. A fourth write-control would have been the
 * fourth attempt at the same idea.
 *
 * So: no new capture surface, and no new habit. `ingestJournal` ALREADY
 * classifies every dump by ThoughtType. This writes the three types that map
 * cleanly onto an existing silo through to that silo, so the 26 files reading
 * `reflections` — identity-snapshot, memory-consolidation, contextual-recall,
 * brain-graph, learning-journal — stop feeding on three-month-old input.
 *
 * ⚠ `situation_log` — READ THIS BEFORE CHANGING IT.
 *
 * It was deliberately NOT derived at first, and the reason still stands as
 * stated: nothing among the ORIGINAL thought types maps onto "strategic
 * situation + matched law", and mapping one on anyway would have manufactured
 * rows the operator never authored.
 *
 * What changed on 2026-09-18 is the premise, not the principle: the classifier
 * gained a real `situation` type of its own, with its own rule ("ABOUT other
 * people's moves, not about Nour's own options"). A dump the model judges to be
 * a situation IS one, on exactly the same footing as its `reflection` and
 * `decision` judgements. So this derives from a first-class classification, not
 * from a reinterpretation of something else.
 *
 * Its readers only ever touch `situation`, `context` and `lawId` — checked
 * 2026-09-18; nothing reads emotion/response/outcome/lessonLearned. So a derived
 * row is fully useful rather than a hollow shell, and `system-health`'s law
 * feedback loop (counting `lawId != null`) stops reading zero forever.
 *
 * ⚠ NOT EMBEDDED, ON PURPOSE. The parent brain_dump is already in the vector
 * index with the same text. Embedding the derived row too would put duplicate
 * content in one index, competing for a finite number of recall slots on every
 * query — the exact cost `lib/brain/embedding-policy.ts` exists to avoid. These
 * rows exist for the STRUCTURED readers, not for semantic search.
 */
import { prisma as defaultPrisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";
import { sanitizeForPrompt } from "@/lib/ai/prompt/sanitize";
import { matchStrategicLaws } from "@/lib/brain/strategic-law-match";
import type { ThoughtType } from "@/lib/brain/journal-ingest";

type PrismaLike = typeof defaultPrisma;

/** ThoughtType -> silo. Only types that map onto a silo WITHOUT invention. */
export const DERIVABLE_TYPES = {
  reflection: "reflection",
  decision: "decision_replay",
  // 2026-09-18 · added ONLY because the classifier now has a real `situation`
  // type of its own. This is NOT the earlier idea of mapping some existing type
  // onto situation_log — that would have manufactured entries the operator never
  // authored. A dump the model judged to be a strategic situation IS one, on
  // exactly the same footing as its `reflection` and `decision` judgements.
  situation: "situation_log",
} as const satisfies Partial<Record<ThoughtType, string>>;

/** Days out the derived decision review is scheduled. Matches the 30/60/90
 *  convention in the DecisionReplay model; 30 is the shortest, so a derived
 *  review surfaces soonest rather than sitting invisible for a quarter. */
export const DERIVED_REVIEW_DAYS = 30;

export interface DeriveInput {
  brainDumpId: string;
  entryType: ThoughtType;
  /** The dump's raw text. */
  text: string;
  /** One-line summary the extractor already produced. */
  summary: string;
  /** YYYY-MM-DD, same string the dump was filed under. */
  dateStr: string;
  /** Free-form arena for a `situation` entry ("pricing", "supplier"). */
  situationContext?: string;
  prisma?: PrismaLike;
}

export interface DeriveResult {
  reflectionId?: string;
  decisionReplayId?: string;
  situationLogId?: string;
  /** Set when nothing was written, with the reason. Never an error. */
  skipped?: string;
}

/**
 * Deterministic per-dump key, so a re-ingest or a retry cannot double-create.
 *
 * `reflections` and `decision_replays` carry `idempotency_key` with a PARTIAL
 * unique index created in raw SQL — which Prisma cannot see, so `upsert` is not
 * available on it. Hence find-then-create, with the duplicate error tolerated as
 * success.
 *
 * ⚠ `situation_logs` HAS NO SUCH COLUMN (verified against schema.prisma
 * 2026-09-18, unlike its two siblings). Its branch dedupes on a provenance
 * marker appended to `situation` instead. Adding a migration for a table that
 * had never held a row was the worse trade; revisit if it ever grows.
 */
export function derivedKey(brainDumpId: string): string {
  return `dump:${brainDumpId}`;
}

/** Minimum text worth promoting. Below this a dump is a fragment, not a
 *  reflection, and a silo row made of it is noise for 26 readers. */
const MIN_TEXT = 40;

function firstSentence(text: string, cap: number): string {
  const s = text.replace(/\s+/g, " ").trim();
  const cut = s.search(/[.!?]\s/);
  return (cut > 15 ? s.slice(0, cut + 1) : s).slice(0, cap);
}

/**
 * Write the derived silo row for a dump, if its type maps onto one.
 *
 * Best-effort by contract: the dump is already saved and is the operator's
 * actual record. A derivation failure must never fail the capture — that would
 * trade a missing convenience row for a lost journal entry.
 */
export async function deriveJournalSilos(input: DeriveInput): Promise<DeriveResult> {
  const prisma = input.prisma ?? defaultPrisma;
  const target = (DERIVABLE_TYPES as Record<string, string | undefined>)[input.entryType];
  if (!target) return { skipped: `entryType "${input.entryType}" maps to no silo` };

  const text = (input.text ?? "").trim();
  if (text.length < MIN_TEXT) return { skipped: `text shorter than ${MIN_TEXT} chars` };

  const idempotencyKey = derivedKey(input.brainDumpId);

  try {
    // Inherit the PARENT's grounding rather than paying for it twice. The dump
    // has its own enrichment pass; when it has already run, copying goal/mission
    // is free and correct. When it has not, `enrichedAt` stays NULL and the
    // existing enrichedAt-null resweep in journal-brain.ts picks the row up —
    // the same durability net journal-reflect.ts (the composer path) relies on.
    const parent = await prisma.brainDump
      .findUnique({
        where: { id: input.brainDumpId },
        select: {
          goalId: true,
          missionId: true,
          linkConfidence: true,
          linkStatus: true,
          enrichedAt: true,
        },
      })
      .catch(() => null);

    const grounding = parent?.enrichedAt
      ? {
          goalId: parent.goalId,
          missionId: parent.missionId,
          linkConfidence: parent.linkConfidence,
          linkStatus: parent.linkStatus,
          enrichedAt: parent.enrichedAt,
        }
      : {};

    if (target === "reflection") {
      const existing = await prisma.reflection.findFirst({
        where: { idempotencyKey },
        select: { id: true },
      });
      if (existing) return { reflectionId: existing.id, skipped: "already derived" };

      const row = await prisma.reflection.create({
        data: {
          date: input.dateStr,
          // Shaped IDENTICALLY to lib/services/journal-reflect.ts (the
          // ReflectComposer's backend). A dump the operator classified as a
          // reflection IS an operator reflection — it arrived through Telegram
          // instead of the composer. Readers select `category`/`scope` but never
          // filter on them (checked 2026-09-18), so this cannot distort a view;
          // a novel category could, by falling through every switch.
          scope: "triggered",
          category: "reflection",
          // SANITIZED, because this text REACHES A PROMPT. reflection-engine.ts
          // builds prompt lines straight from `r.insight` (:278, :492), and
          // journal-ingest.ts already sanitizes every other operator string it
          // stores for later prompt use (:434, :512). Storing raw here would have
          // been a role-flip surface in a repo that has a dedicated sanitizer for
          // exactly this.
          insight: sanitizeForPrompt(text, 4000),
          evidence: `derived from brain_dump ${input.brainDumpId} · captured via /dump`,
          confidence: 0.7,
          actionable: false,
          acknowledged: true,
          idempotencyKey,
          metadata: {
            createdFrom: "journal-silo-derive",
            brainDumpId: input.brainDumpId,
            entryType: input.entryType,
            summary: input.summary?.slice(0, 300) ?? null,
          },
          ...grounding,
        },
        select: { id: true },
      });
      return { reflectionId: row.id };
    }

    if (target === "situation_log") {
      const existing = await prisma.situationLog.findFirst({
        where: { lawId: null, situation: { contains: input.brainDumpId } },
        select: { id: true },
      });
      // situation_logs has NO idempotency_key column (unlike its two siblings),
      // so the dedupe key rides in `evidence`-style provenance instead. Checked
      // rather than assumed: the model carries no such field, and inventing a
      // migration for a table that has never held a row would be the wrong
      // trade. The marker below is what this lookup matches.
      if (existing) return { situationLogId: existing.id, skipped: "already derived" };

      const laws = await matchStrategicLaws(text, prisma);
      const row = await prisma.situationLog.create({
        data: {
          // Provenance is appended, not prefixed: `journal-fanout` renders
          // `[situation <context>] <situation>` into the embedding, and a
          // leading marker would dominate the vector.
          situation: `${sanitizeForPrompt(text, 3800)}\n\n[derived from brain_dump ${input.brainDumpId}]`,
          // Free-form in the schema ("competition", "pricing", "employee"), so
          // the extractor's own words go through. "unspecified" is the honest
          // fallback — NOT a guessed arena.
          context: (input.situationContext || "").trim().slice(0, 80) || "unspecified",
          // A hint the operator can correct, never a claim the law applies.
          lawId: laws[0]?.id ?? null,
          ...grounding,
        },
        select: { id: true },
      });
      return { situationLogId: row.id };
    }

    const existing = await prisma.decisionReplay.findFirst({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) return { decisionReplayId: existing.id, skipped: "already derived" };

    const reviewAt = new Date(Date.now() + DERIVED_REVIEW_DAYS * 86_400_000);
    const row = await prisma.decisionReplay.create({
      data: {
        title: sanitizeForPrompt(input.summary?.trim() || firstSentence(text, 120), 200),
        context: sanitizeForPrompt(text, 4000),
        // ⚠ LOSSY AND SAID SO. A free-text dump has no separately-stated
        // "choice"; the opening sentence is the closest honest approximation.
        // The full text is preserved in `context`, so nothing is lost — only
        // the split between choice and reasoning is approximate.
        choiceMade: sanitizeForPrompt(firstSentence(text, 500), 500),
        reviewAt,
        idempotencyKey,
        ...grounding,
      },
      select: { id: true },
    });
    return { decisionReplayId: row.id };
  } catch (err) {
    // A unique-violation means a concurrent ingest won the race — that is the
    // idempotency working, not a failure.
    const code = (err as { code?: string })?.code;
    if (code === "P2002") return { skipped: "concurrent derive won the race" };
    logError(
      "brain.journal-silo-derive",
      err,
      { brainDumpId: input.brainDumpId, entryType: input.entryType },
      "warn",
    );
    return { skipped: "derive failed — see error_logs" };
  }
}
