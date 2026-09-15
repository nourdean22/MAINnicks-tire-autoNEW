/**
 * Reality Ledger — write and read side of the Evidence Substrate.
 *
 * Inbound shapes are validated with zod at the boundary; everything past it
 * trusts the types. Writers never throw on a partially-bad batch: valid rows
 * land, rejected rows are reported back by index, because a cron that posts
 * one malformed event must not lose the other nine.
 *
 * The taste judgment writer also mirrors a compact row into brain_memories
 * (category "design_decision", trustTier OPERATOR, createdBy "user") so the
 * existing recall path sees Nour's decisions without a second retrieval
 * system. The judgment table stays the structured source of truth.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const EVIDENCE_GRADES = ["H0", "H1", "H2", "H3", "H4", "H5"] as const;

export const RealityEventInputSchema = z.object({
  eventType: z.string().min(3).max(80).regex(/^[a-z0-9_.]+$/, "dotted lower_snake"),
  observedAt: z.string().datetime().optional(),
  objects: z.array(z.object({ type: z.string().min(1).max(40), id: z.string().min(1).max(200), role: z.string().max(40).optional() })).min(1).max(20),
  source: z.object({ system: z.string().min(1).max(64), version: z.string().max(40).optional(), uri: z.string().max(500).optional() }),
  experiment: z.object({ experimentId: z.string().max(120), variantId: z.string().max(64).optional(), contractHash: z.string().max(32).optional() }).optional(),
  quality: z.enum(["observed", "derived", "inferred"]).default("observed"),
  privacy: z.enum(["public", "internal"]).default("internal"),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type RealityEventInput = z.infer<typeof RealityEventInputSchema>;

export const EvidenceClaimInputSchema = z.object({
  claimText: z.string().min(5).max(4000),
  grade: z.enum(EVIDENCE_GRADES),
  hypothesisId: z.string().max(120).optional(),
  goalId: z.string().max(80).optional(),
  contractHash: z.string().max(32).optional(),
  sourceEventKeys: z.array(z.string().max(200)).max(50).optional(),
  confidence: z.number().min(0).max(1).optional(),
  disposition: z.enum(["supported", "refuted", "inconclusive"]).default("inconclusive"),
  createdBy: z.enum(["agent", "cron", "operator"]).default("agent"),
});
export type EvidenceClaimInput = z.infer<typeof EvidenceClaimInputSchema>;

export const EvidenceBatchSchema = z.object({
  events: z.array(z.unknown()).max(200).default([]),
  claims: z.array(z.unknown()).max(100).default([]),
  sender: z.string().min(1).max(64).default("unknown"),
  sentAt: z.string().datetime().optional(),
});

export interface BatchReceipt {
  eventsWritten: number;
  claimsWritten: number;
  rejected: Array<{ kind: "event" | "claim"; index: number; error: string }>;
}

/** PII must not enter the ledger — a coarse tripwire on payload keys, not a substitute for the writer's discipline. */
const PII_KEY = /plate|customer_?id|customerId|phone|email|vin\b|last_?name|first_?name/i;

export async function recordEvidenceBatch(raw: unknown): Promise<BatchReceipt> {
  const batch = EvidenceBatchSchema.parse(raw);
  const receipt: BatchReceipt = { eventsWritten: 0, claimsWritten: 0, rejected: [] };

  const events: RealityEventInput[] = [];
  const issues = (err: z.ZodError) => err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  batch.events.forEach((e, index) => {
    const r = RealityEventInputSchema.safeParse(e);
    if (!r.success) {
      receipt.rejected.push({ kind: "event", index, error: issues(r.error) });
      return;
    }
    const piiKey = Object.keys(r.data.payload ?? {}).find((k) => PII_KEY.test(k));
    if (piiKey) {
      receipt.rejected.push({ kind: "event", index, error: `payload key "${piiKey}" looks like PII — the ledger is aggregate-only` });
      return;
    }
    events.push(r.data);
  });
  const claims: EvidenceClaimInput[] = [];
  batch.claims.forEach((c, index) => {
    const r = EvidenceClaimInputSchema.safeParse(c);
    if (!r.success) {
      receipt.rejected.push({ kind: "claim", index, error: issues(r.error) });
      return;
    }
    claims.push(r.data);
  });

  if (events.length) {
    const res = await prisma.realityEvent.createMany({
      data: events.map((e) => ({
        eventType: e.eventType,
        observedAt: e.observedAt ? new Date(e.observedAt) : new Date(),
        objects: e.objects as Prisma.InputJsonValue,
        sourceSystem: e.source.system,
        sourceUri: e.source.uri ?? null,
        experimentId: e.experiment?.experimentId ?? null,
        variantId: e.experiment?.variantId ?? null,
        contractHash: e.experiment?.contractHash ?? null,
        quality: e.quality,
        privacy: e.privacy,
        payload: (e.payload ?? undefined) as Prisma.InputJsonValue | undefined,
        sender: batch.sender,
      })),
    });
    receipt.eventsWritten = res.count;
  }
  if (claims.length) {
    const res = await prisma.evidenceClaim.createMany({
      data: claims.map((c) => ({
        claimText: c.claimText,
        grade: c.grade,
        disposition: c.disposition.toUpperCase() as "SUPPORTED" | "REFUTED" | "INCONCLUSIVE",
        hypothesisId: c.hypothesisId ?? null,
        goalId: c.goalId ?? null,
        contractHash: c.contractHash ?? null,
        sourceEventKeys: c.sourceEventKeys ?? undefined,
        confidence: c.confidence ?? null,
        createdBy: c.createdBy.toUpperCase() as "AGENT" | "CRON" | "OPERATOR",
      })),
    });
    receipt.claimsWritten = res.count;
  }
  return receipt;
}

export const TasteJudgmentInputSchema = z.object({
  surface: z.enum(["nickstire", "statenour"]),
  context: z.string().min(5).max(4000),
  candidateA: z.record(z.string(), z.unknown()),
  candidateB: z.record(z.string(), z.unknown()),
  winner: z.enum(["A", "B"]),
  reasonCodes: z.array(z.string().min(2).max(40)).min(1).max(12),
  rationale: z.string().max(4000).optional(),
  goalId: z.string().max(80).optional(),
  decidedBy: z.string().min(1).max(64).default("operator"),
});
export type TasteJudgmentInput = z.infer<typeof TasteJudgmentInputSchema>;

/** The reason-code vocabulary the critic is shown. Free text goes in `rationale`. */
export const TASTE_REASON_CODES = [
  "less_saas", "more_physical", "clearer_primary_action", "better_hierarchy", "denser_proof", "less_chrome",
  "stronger_asymmetry", "preserves_shop_texture", "too_generic", "too_flat", "decorative_motion", "reads_as_ai", "brand_drift", "claims_unsafe",
] as const;

export async function recordTasteJudgment(raw: unknown) {
  const j = TasteJudgmentInputSchema.parse(raw);
  const row = await prisma.tasteJudgment.create({
    data: {
      surface: j.surface,
      context: j.context,
      candidateA: j.candidateA as Prisma.InputJsonValue,
      candidateB: j.candidateB as Prisma.InputJsonValue,
      winner: j.winner,
      reasonCodes: j.reasonCodes,
      rationale: j.rationale ?? null,
      goalId: j.goalId ?? null,
      decidedBy: j.decidedBy,
    },
  });
  // Mirror for recall. OPERATOR trust tier: this IS something Nour said.
  await prisma.brainMemory
    .create({
      data: {
        category: "design_decision",
        key: `taste:${row.id}`,
        content: `On ${j.surface}, preferred ${j.winner} — ${j.reasonCodes.join(", ")}${j.rationale ? `. ${j.rationale}` : ""}. Context: ${j.context.slice(0, 300)}`,
        confidence: 1,
        source: "manual",
        createdBy: "user",
        trustTier: "OPERATOR",
        metadata: { tasteJudgmentId: row.id, goalId: j.goalId ?? null, winner: j.winner, reasonCodes: j.reasonCodes },
      },
    })
    .catch(() => undefined); // the judgment row is the record; the mirror is a convenience
  return row;
}

export async function proofSummary(limit = 12) {
  const [claimsByGrade, events, claims, judgments, proposals] = await Promise.all([
    prisma.evidenceClaim.groupBy({ by: ["grade"], _count: { _all: true } }),
    prisma.realityEvent.findMany({ orderBy: { observedAt: "desc" }, take: limit }),
    prisma.evidenceClaim.findMany({ orderBy: { createdAt: "desc" }, take: limit }),
    prisma.tasteJudgment.findMany({ orderBy: { decidedAt: "desc" }, take: limit }),
    prisma.workItem.findMany({ where: { type: "DREAM_TO_PROOF_PROPOSAL" }, orderBy: { createdAt: "desc" }, take: limit }),
  ]);
  const byGrade = Object.fromEntries(EVIDENCE_GRADES.map((g) => [g, 0])) as Record<(typeof EVIDENCE_GRADES)[number], number>;
  for (const row of claimsByGrade) byGrade[row.grade] = row._count._all;
  return { byGrade, events, claims, judgments, proposals, generatedAt: new Date().toISOString() };
}
