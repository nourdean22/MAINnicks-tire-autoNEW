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
import { logger as rootLogger } from "@/lib/logger";
import { claimReceipt, isReceiptTableMissing, settleReceipt } from "@/lib/services/bridge-receipts";
import {
  REALITY_EVENT_RETENTION_CLASSES,
  validateRealityEventRegistration,
  type RealityEventRegistrationResult,
} from "@/lib/events/reality-event-registry";

const log = rootLogger.withSurface("services/reality-ledger");

export const EVIDENCE_GRADES = ["H0", "H1", "H2", "H3", "H4", "H5"] as const;

export const RealityEventInputSchema = z.object({
  eventType: z.string().min(3).max(80).regex(/^[a-z0-9_.]+$/, "dotted lower_snake"),
  /** Q-25: omitted by legacy producers; when supplied it must match the registry. */
  eventVersion: z.number().int().min(1).optional(),
  /** Canonical source-domain event time. Legacy producers may still send observedAt only. */
  occurredAt: z.string().datetime().optional(),
  observedAt: z.string().datetime().optional(),
  correlationId: z.string().min(1).max(160).optional(),
  causationId: z.string().min(1).max(160).optional(),
  /** Registry-owned retention class; an explicit mismatch is rejected. */
  retentionClass: z.enum(REALITY_EVENT_RETENTION_CLASSES).optional(),
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
  /** The grade the producer ASKS for. The ledger grants at most the producer's ceiling (see PRODUCER_CEILING). */
  grade: z.enum(EVIDENCE_GRADES),
  hypothesisId: z.string().max(120).optional(),
  goalId: z.string().max(80).optional(),
  contractHash: z.string().max(32).optional(),
  /** External keys (rows outside this ledger) the claim rests on. */
  sourceEventKeys: z.array(z.string().max(200)).max(50).optional(),
  /**
   * Indexes into THIS batch's `events` array. The ledger resolves them to the
   * created RealityEvent ids, so a claim can rest on events it posts in the
   * same request without knowing ids in advance — structural lineage, not a
   * sentence saying "see the event next to me".
   */
  sourceEventIndexes: z.array(z.number().int().min(0).max(199)).max(20).optional(),
  confidence: z.number().min(0).max(1).optional(),
  disposition: z.enum(["supported", "refuted", "inconclusive"]).default("inconclusive"),
  /**
   * 2026-09-15 · NOT authoritative. Provenance is derived from the door the
   * request came through (PRODUCER_AUTHOR); a payload that asks for "operator"
   * from any keyed door is refused as authority laundering. Kept in the schema
   * so old producers still validate.
   */
  createdBy: z.enum(["agent", "cron", "operator"]).optional(),
});
export type EvidenceClaimInput = z.infer<typeof EvidenceClaimInputSchema>;

/**
 * Who is posting, derived from AUTHENTICATION, never from the payload.
 *   ledger   — the scoped EVIDENCE_LEDGER_KEY (proof workflow, Night Shift)
 *   bridge   — STATENOUR_SYNC_KEY (nickstire's server: crons, the experiment resolver)
 *   operator — an owner-authenticated surface (/api/proof/*), never a key
 */
export type EvidenceProducer = "ledger" | "bridge" | "operator";

/**
 * The most a producer can be believed. A key can report what it observed; it
 * cannot decide how much authority the observation deserves. Grades above the
 * ceiling are refused at the door (loud), never silently clamped.
 *   ledger   ≤ H2 · deterministic CI/evaluator results and a hypothesis (Night Shift ≤ H1 by its prompt)
 *   bridge   ≤ H4 · the calibrated randomized path (the experiment resolver) — provisional until the
 *                   kernel passes its A/A + injected-effect calibration (see docs/DREAM-TO-PROOF.md)
 *   operator ≤ H5 · a verified physical/business postcondition, asserted by the owner
 */
export const PRODUCER_CEILING: Record<EvidenceProducer, (typeof EVIDENCE_GRADES)[number]> = {
  ledger: "H2",
  bridge: "H4",
  operator: "H5",
};
export const PRODUCER_AUTHOR: Record<EvidenceProducer, "AGENT" | "CRON" | "OPERATOR"> = {
  ledger: "AGENT",
  bridge: "CRON",
  operator: "OPERATOR",
};
export function gradeRank(g: (typeof EVIDENCE_GRADES)[number]): number {
  return EVIDENCE_GRADES.indexOf(g);
}

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
  /** ADR-0019: this Idempotency-Key was already recorded; nothing was written. */
  duplicate?: true;
  /** On a duplicate: the first row the first delivery wrote ("none" when it wrote no row). */
  resultRef?: string | null;
  /** The key was sent but bridge_receipts is not migrated yet, so the batch was written without dedupe. */
  dedupe?: "unavailable";
}

/** Route name recorded on this door's receipts. */
export const EVIDENCE_RECEIPT_ROUTE = "sync/evidence";

/**
 * PII must not enter the ledger. Two tripwires, both recursive (2026-09-15 —
 * the first version looked only at top-level payload keys, so
 * `customer: { phone }` and an email inside a string value walked straight in):
 *   · a KEY anywhere in the payload/objects that names a person-identifying field;
 *   · a string VALUE anywhere (payload, objects, source.uri, claim text) shaped
 *     like an email, a phone number or a VIN.
 * Not a substitute for typed per-event schemas; a last line, not the line.
 */
const PII_KEY = /plate|customer_?id|customerId|phone|email|vin\b|last_?name|first_?name|full_?name|ssn|dob|date_?of_?birth|address/i;
const PII_VALUE: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+\.[\w.-]{2,}/, "email"],
  [/(?:^|[^\d])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/, "phone"],
  [/\b[A-HJ-NPR-Z0-9]{11}\d{6}\b/, "vin"],
];

/** First PII-shaped key or value under `value`, as a dotted path + reason; null when clean. */
export function findPii(value: unknown, path = ""): { path: string; reason: string } | null {
  if (typeof value === "string") {
    for (const [re, reason] of PII_VALUE) if (re.test(value)) return { path: path || "(value)", reason: `value looks like ${reason}` };
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findPii(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (PII_KEY.test(k)) return { path: p, reason: "key looks like PII" };
      const hit = findPii(v, p);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Producers submit observations; the ledger computes authority.
 *
 * `ctx.producer` comes from the route's authentication (which key opened the
 * door, or an owner session) — never from the body. A claim that asks for more
 * than its producer's ceiling, or for OPERATOR provenance through a keyed door,
 * is refused by index so the producer sees exactly what it tried to launder.
 */
export async function recordEvidenceBatch(
  raw: unknown,
  ctx: { producer: EvidenceProducer; idempotencyKey?: string | null },
): Promise<BatchReceipt> {
  const batch = EvidenceBatchSchema.parse(raw);
  const receipt: BatchReceipt = { eventsWritten: 0, claimsWritten: 0, rejected: [] };
  const ceiling = PRODUCER_CEILING[ctx.producer];
  const author = PRODUCER_AUTHOR[ctx.producer];

  const issues = (err: z.ZodError) => err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");

  // Events keep their batch index (claims reference it), so a rejected event
  // leaves a hole that a claim pointing at it must not silently fall through.
  const events: Array<{
    index: number;
    data: RealityEventInput;
    registration: Extract<RealityEventRegistrationResult, { ok: true }>;
  }> = [];
  batch.events.forEach((e, index) => {
    const r = RealityEventInputSchema.safeParse(e);
    if (!r.success) {
      receipt.rejected.push({ kind: "event", index, error: issues(r.error) });
      return;
    }
    // Security ordering is intentional: after the generic envelope shape is
    // parseable, reject PII BEFORE family-specific payload validation. Otherwise
    // an experiment payload such as { customer: { phone: ... } } can fail first
    // on a missing business field and mask the stronger aggregate-only refusal.
    const pii = findPii({
      payload: r.data.payload ?? {},
      objects: r.data.objects,
      sourceUri: r.data.source.uri ?? "",
      correlationId: r.data.correlationId ?? "",
      causationId: r.data.causationId ?? "",
    });
    if (pii) {
      receipt.rejected.push({ kind: "event", index, error: `${pii.path}: ${pii.reason} — the ledger is aggregate-only` });
      return;
    }
    const registration = validateRealityEventRegistration({
      eventType: r.data.eventType,
      eventVersion: r.data.eventVersion,
      retentionClass: r.data.retentionClass,
      payload: r.data.payload,
      // 2026-10-09: the door, so a door-scoped family (receptionist.*) can
      // refuse other key holders. Families without a scope ignore it.
      producer: ctx.producer,
    });
    if (!registration.ok) {
      receipt.rejected.push({ kind: "event", index, error: registration.error });
      return;
    }
    events.push({ index, data: r.data, registration });
  });
  const landable = new Set(events.map((e) => e.index));

  const claims: Array<{ index: number; data: EvidenceClaimInput }> = [];
  batch.claims.forEach((c, index) => {
    const r = EvidenceClaimInputSchema.safeParse(c);
    if (!r.success) {
      receipt.rejected.push({ kind: "claim", index, error: issues(r.error) });
      return;
    }
    if (gradeRank(r.data.grade) > gradeRank(ceiling)) {
      receipt.rejected.push({ kind: "claim", index, error: `grade ${r.data.grade} exceeds this producer's ceiling ${ceiling} — submit the observation, not the authority` });
      return;
    }
    if (r.data.createdBy === "operator" && ctx.producer !== "operator") {
      receipt.rejected.push({ kind: "claim", index, error: `createdBy "operator" is not available through a keyed door (provenance is derived: ${author})` });
      return;
    }
    const pii = findPii({ claimText: r.data.claimText });
    if (pii) {
      receipt.rejected.push({ kind: "claim", index, error: `${pii.path}: ${pii.reason} — the ledger is aggregate-only` });
      return;
    }
    // 2026-10-09: lineage is checked HERE, before the batch decides whether to
    // claim its Idempotency-Key. A claim resting on an event this batch refused
    // (or never sent) can never land. Counted as valid, it used to claim the key
    // and settle it "none", so a corrected resend under the same key came back
    // duplicate:true with nothing written. The in-transaction check below is
    // now only a backstop.
    const dangling = (r.data.sourceEventIndexes ?? []).find((i) => !landable.has(i));
    if (dangling !== undefined) {
      receipt.rejected.push({ kind: "claim", index, error: `sourceEventIndexes[${dangling}] does not name an event written by this batch` });
      return;
    }
    claims.push({ index, data: r.data });
  });

  // ADR-0019 §6.2: the receipt joins the batch's transaction. A batch with
  // nothing valid to write records no receipt, so a corrected resend under the
  // same key is not swallowed as a duplicate of a batch that landed nothing.
  const key = ctx.idempotencyKey && (events.length > 0 || claims.length > 0) ? ctx.idempotencyKey : null;
  if (!key) {
    await writeBatch(null);
    return receipt;
  }
  const validationRejects = receipt.rejected.slice();
  try {
    await writeBatch(key);
  } catch (err) {
    if (!isReceiptTableMissing(err)) throw err;
    // The transaction rolled back whole; nothing from the keyed attempt landed.
    receipt.eventsWritten = 0;
    receipt.claimsWritten = 0;
    receipt.rejected = validationRejects;
    receipt.dedupe = "unavailable";
    await writeBatch(null);
  }
  return receipt;

  async function writeBatch(receiptKey: string | null): Promise<void> {
    await prisma.$transaction(async (tx) => {
      if (receiptKey) {
        const claim = await claimReceipt(tx, receiptKey, EVIDENCE_RECEIPT_ROUTE);
        if (!claim.first) {
          receipt.duplicate = true;
          receipt.resultRef = claim.resultRef;
          receipt.rejected = [];
          return;
        }
      }
      const idByIndex = new Map<number, string>();
      let firstRef: string | null = null;
      for (const { index, data: e, registration } of events) {
        const legacyTime = e.observedAt ? new Date(e.observedAt) : new Date();
        const occurredAt = e.occurredAt ? new Date(e.occurredAt) : legacyTime;
        const row = await tx.realityEvent.create({
          data: {
            eventType: e.eventType,
            eventVersion: registration.eventVersion,
            occurredAt,
            // Keep observedAt backward-compatible for existing readers while
            // occurredAt becomes the canonical source-domain clock.
            observedAt: legacyTime,
            correlationId: e.correlationId ?? null,
            causationId: e.causationId ?? null,
            retentionClass: registration.retentionClass,
            objects: e.objects as Prisma.InputJsonValue,
            sourceSystem: e.source.system,
            sourceUri: e.source.uri ?? null,
            experimentId: e.experiment?.experimentId ?? null,
            variantId: e.experiment?.variantId ?? null,
            contractHash: e.experiment?.contractHash ?? null,
            quality: e.quality,
            privacy: e.privacy,
            payload: registration.payload as Prisma.InputJsonValue,
            sender: batch.sender,
          },
          select: { id: true },
        });
        idByIndex.set(index, row.id);
        firstRef ??= row.id;
        receipt.eventsWritten += 1;
      }
      for (const { index, data: c } of claims) {
        const linked: string[] = [];
        let broken: number | null = null;
        for (const i of c.sourceEventIndexes ?? []) {
          const id = idByIndex.get(i);
          if (!id) { broken = i; break; }
          linked.push(id);
        }
        if (broken !== null) {
          // A claim that says it rests on an event this batch did not land has no lineage — refuse it.
          // Backstop only: the pre-validation above already refuses these before the key is claimed.
          receipt.rejected.push({ kind: "claim", index, error: `sourceEventIndexes[${broken}] does not name an event written by this batch` });
          continue;
        }
        const sourceEventKeys = [...(c.sourceEventKeys ?? []), ...linked];
        const claimRow = await tx.evidenceClaim.create({
          data: {
            claimText: c.claimText,
            grade: c.grade,
            disposition: c.disposition.toUpperCase() as "SUPPORTED" | "REFUTED" | "INCONCLUSIVE",
            hypothesisId: c.hypothesisId ?? null,
            goalId: c.goalId ?? null,
            contractHash: c.contractHash ?? null,
            sourceEventKeys: sourceEventKeys.length ? sourceEventKeys : undefined,
            confidence: c.confidence ?? null,
            createdBy: author,
          },
          select: { id: true },
        });
        firstRef ??= claimRow.id;
        receipt.claimsWritten += 1;
      }
      if (receiptKey) await settleReceipt(tx, receiptKey, firstRef ?? "none");
    });
  }
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

/**
 * A read that must survive the ledger tables not existing yet. The migration
 * is hand-applied while `main` auto-deploys, so for a window the code is live
 * and the tables are not; /proof must say "not migrated" rather than 500.
 * Prisma reports a missing table as P2021 (and a missing enum/column as
 * P2022); anything else is a real error and still surfaces.
 */
export async function ledgerRead<T>(read: () => Promise<T>, fallback: T, missing: string[]): Promise<T> {
  try {
    return await read();
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "P2021" || code === "P2022") {
      missing.push(code);
      return fallback;
    }
    throw err;
  }
}

export async function proofSummary(limit = 12) {
  const missing: string[] = [];
  const [claimsByGrade, events, claims, judgments, proposals] = await Promise.all([
    ledgerRead(() => prisma.evidenceClaim.groupBy({ by: ["grade"], _count: { _all: true } }), [], missing),
    ledgerRead(() => prisma.realityEvent.findMany({ orderBy: { observedAt: "desc" }, take: limit }), [], missing),
    ledgerRead(() => prisma.evidenceClaim.findMany({ orderBy: { createdAt: "desc" }, take: limit }), [], missing),
    ledgerRead(() => prisma.tasteJudgment.findMany({ orderBy: { decidedAt: "desc" }, take: limit }), [], missing),
    ledgerRead(() => prisma.workItem.findMany({ where: { type: "DREAM_TO_PROOF_PROPOSAL" }, orderBy: { createdAt: "desc" }, take: limit }), [], missing),
  ]);
  const byGrade = Object.fromEntries(EVIDENCE_GRADES.map((g) => [g, 0])) as Record<(typeof EVIDENCE_GRADES)[number], number>;
  for (const row of claimsByGrade) byGrade[row.grade] = row._count._all;
  return {
    /** false = at least one ledger table/enum is missing — the migration has not been applied. */
    ledgerAvailable: missing.length === 0,
    byGrade,
    events,
    claims,
    judgments,
    proposals,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Receptionist prompt experiments (2026-10-09): the read side of the
 * `receptionist.prompt_experiment` RealityEvent that nickstire's weekly
 * prompt-evolution run posts (source.uri "cron:prompt-evolution-weekly"),
 * one receipt per run. /proof renders these read-only; approving a candidate
 * stays the operator's Push Config in Nick's admin, never a button here.
 *
 * Three states, never two (repo skill empty-vs-error):
 *   ok, rows        the read succeeded; an EMPTY list is a measured "none yet".
 *   unavailable     not_migrated (P2021/P2022, via ledgerRead) or read_failed
 *                   (any other error, logged). Renders as "couldn't load",
 *                   NEVER as "no experiments": a dead read must not look like
 *                   a quiet week.
 * This helper never throws, so one bad read cannot 500 the rest of /proof.
 *
 * Rows are mapped from untyped JSON, reading only the keys the producer
 * writes (apps/nickstire/server/services/promptEvolutionReceipt.ts gateOf /
 * lanes). A gate the run never reached (success / confirmation null or absent)
 * is `ran: false`; a gate that ran without a readable `reason` is verdict null
 * ("unknown" on the page), never a pass; an absent number is null, never 0; an
 * unreadable lane parity is "unknown", never "match".
 *
 * Provenance: the registry scopes this type to the bridge door (nickstire's
 * STATENOUR_SYNC_KEY), so another key holder cannot write a row here. Order
 * is the server-set createdAt, newest first: occurredAt is producer-supplied,
 * and one far-future value would otherwise hold the top row forever.
 */
export const RECEPTIONIST_EXPERIMENT_EVENT_TYPE = "receptionist.prompt_experiment";

export interface PromptExperimentGateView {
  /** false = the gate key was absent or null: the run never reached this gate. */
  ran: boolean;
  /** The gate's `reason` verbatim ("improved", "regressed-seed", "preserved", ...); null = ran but no readable reason. */
  verdict: string | null;
  pValue: number | null;
  /** Seeds both arms resolved (the paired test's n), and how many moved up / down. */
  comparable: number | null;
  improved: number | null;
  worsened: number | null;
}

export interface PromptExperimentRow {
  /** RealityEvent id. */
  id: string;
  /** The `{ type: "experiment" }` object id, e.g. "prompt-evolution:<hex>"; null when the producer sent none. */
  experimentId: string | null;
  /** ISO; the event's canonical occurredAt (falls back to observedAt). */
  occurredAt: string;
  outcome: string | null;
  promotionStage: string | null;
  cohorts: { train: number | null; holdout: number | null; confirm: number | null; success: number | null };
  holdout: PromptExperimentGateView;
  success: PromptExperimentGateView;
  confirmation: PromptExperimentGateView;
  /** Replay lane vs live config. lanes.parity true = match; false (or any difference listed) = mismatch; anything else = unknown. */
  laneParity: "match" | "mismatch" | "unknown";
  laneDifferences: string[];
  /** previousProposal.status verbatim (e.g. "applied"); null = not reported. */
  previousProposalStatus: string | null;
}

export type PromptExperimentsRead =
  | { status: "ok"; rows: PromptExperimentRow[] }
  | { status: "unavailable"; reason: "not_migrated" | "read_failed" };

export interface PromptExperimentEventLike {
  id: string;
  occurredAt?: Date | string | null;
  observedAt: Date | string;
  objects: unknown;
  payload: unknown;
}

type JsonRec = Record<string, unknown>;
const asRec = (v: unknown): JsonRec => (v && typeof v === "object" && !Array.isArray(v) ? (v as JsonRec) : {});
const asNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const asStr = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function gateView(raw: unknown): PromptExperimentGateView {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ran: false, verdict: null, pValue: null, comparable: null, improved: null, worsened: null };
  }
  const g = raw as JsonRec;
  return {
    ran: true,
    verdict: asStr(g.reason),
    pValue: asNum(g.pValue),
    comparable: asNum(g.comparable),
    improved: asNum(g.improved),
    worsened: asNum(g.worsened),
  };
}

function laneDifferenceLabels(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((d) => (asStr(d) === null ? [] : [d as string]));
}

/** Pure: one ledger row -> the /proof view. Never throws on a malformed payload. */
export function toPromptExperimentRow(e: PromptExperimentEventLike): PromptExperimentRow {
  const p = asRec(e.payload);
  const gates = asRec(p.gates);
  const cohorts = asRec(p.cohorts);
  const lanes = asRec(p.lanes);
  const differences = laneDifferenceLabels(lanes.differences);
  const parity = lanes.parity;
  const laneParity: PromptExperimentRow["laneParity"] =
    parity === true ? "match" : parity === false || differences.length > 0 ? "mismatch" : "unknown";
  const experimentObject = Array.isArray(e.objects) ? e.objects.map(asRec).find((o) => o.type === "experiment") : undefined;
  return {
    id: e.id,
    experimentId: asStr(experimentObject?.id),
    occurredAt: new Date(e.occurredAt ?? e.observedAt).toISOString(),
    outcome: asStr(p.outcome),
    promotionStage: asStr(p.promotionStage),
    cohorts: {
      train: asNum(cohorts.train),
      holdout: asNum(cohorts.holdout),
      confirm: asNum(cohorts.confirm),
      success: asNum(cohorts.success),
    },
    holdout: gateView(gates.holdout),
    success: gateView(gates.success),
    confirmation: gateView(gates.confirmation),
    laneParity,
    laneDifferences: differences,
    previousProposalStatus: asStr(asRec(p.previousProposal).status),
  };
}

/** Newest received first (server createdAt). `limit` is clamped to 1..50. Never throws (see the block comment above). */
export async function recentPromptExperiments(limit = 8): Promise<PromptExperimentsRead> {
  const take = Math.min(50, Math.max(1, Math.floor(limit) || 8));
  const missing: string[] = [];
  try {
    const events = await ledgerRead<PromptExperimentEventLike[]>(
      () =>
        prisma.realityEvent.findMany({
          where: { eventType: RECEPTIONIST_EXPERIMENT_EVENT_TYPE },
          orderBy: { createdAt: "desc" },
          take,
          select: { id: true, occurredAt: true, observedAt: true, objects: true, payload: true },
        }),
      [],
      missing,
    );
    if (missing.length > 0) return { status: "unavailable", reason: "not_migrated" };
    return { status: "ok", rows: events.map(toPromptExperimentRow) };
  } catch (err) {
    log.error("prompt_experiments_read_failed", { error: err instanceof Error ? err.message : String(err) });
    return { status: "unavailable", reason: "read_failed" };
  }
}
