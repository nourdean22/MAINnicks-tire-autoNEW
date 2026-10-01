import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordEpisode } from "@/lib/intelligence/episodes";
import { ServiceError } from "@/lib/utils/service-error";

export const ValueObservationSchema = z
  .object({
    observationId: z.string().trim().min(3).max(160),
    attributionRef: z.string().trim().min(3).max(190),
    direction: z.enum(["cost", "value"]),
    category: z.enum([
      "ai",
      "sms",
      "voice",
      "recovered_revenue",
      "other",
    ]),
    amountCents: z.number().int().nonnegative().max(2_000_000_000),
    currency: z.literal("USD").default("USD"),
    measurement: z.enum(["MEASURED", "ESTIMATE"]),
    sourceSystem: z.string().trim().min(2).max(80),
    sourceRef: z.string().trim().min(1).max(300).optional(),
    method: z.string().trim().min(3).max(800),
    holdoutAdjusted: z.boolean().default(false),
    outcomeCount: z.number().int().positive().max(1_000_000).optional(),
    occurredAt: z.coerce.date().optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.direction === "cost" &&
      value.category === "recovered_revenue"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["category"],
        message: "recovered_revenue is a value, not a cost",
      });
    }
    if (
      value.direction === "value" &&
      ["ai", "sms", "voice"].includes(value.category)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["category"],
        message: `${value.category} is a cost category`,
      });
    }
    if (
      value.category === "recovered_revenue" &&
      value.measurement === "MEASURED" &&
      !value.holdoutAdjusted
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["holdoutAdjusted"],
        message:
          "measured recovered revenue must be holdout-adjusted before StateNour may treat it as causal value",
      });
    }
    if (value.outcomeCount !== undefined && value.direction !== "value") {
      ctx.addIssue({
        code: "custom",
        path: ["outcomeCount"],
        message: "outcomeCount belongs on value observations",
      });
    }
  });

export type ValueObservationInput = z.input<typeof ValueObservationSchema>;

export interface CostPerOutcomeAttribution {
  windowDays: number;
  observedEvents: number;
  measuredSendCostCents: number;
  estimatedSendCostCents: number;
  measuredRecoveredRevenueCents: number;
  estimatedRecoveredRevenueCents: number;
  matchedRefs: number;
  matchedMeasuredCostCents: number;
  matchedMeasuredRecoveredRevenueCents: number;
  measuredRecoveredOutcomes: number;
  costPerRecoveredOutcomeCents: number | null;
  recoveredRevenuePerSendCostDollar: number | null;
  measurementState: "MEASURED" | "ESTIMATE" | "UNMEASURED";
  reasons: string[];
  generatedAt: string;
}

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asFiniteInt(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

/**
 * Append a source-backed cost/value observation to the existing RealityEvent
 * episode spine. The stable observationId is used as a best-effort idempotency
 * guard; no new value database or hidden attribution table is introduced.
 */
export async function recordValueObservation(raw: ValueObservationInput) {
  const input = ValueObservationSchema.parse(raw);
  const episodeId = `value:${input.observationId}`;

  const existing = await prisma.realityEvent.findFirst({
    where: {
      eventType: "episode.business_outcome.value_observed",
      payload: { path: ["episodeId"], equals: episodeId },
    },
    select: { id: true },
  });
  if (existing) {
    return {
      ok: true as const,
      recorded: false as const,
      duplicate: true as const,
      episodeId,
      realityEventId: existing.id,
    };
  }

  const common = {
    attributionRef: input.attributionRef,
    category: input.category,
    amountCents: input.amountCents,
    currency: input.currency,
    measurement: input.measurement,
    sourceSystem: input.sourceSystem,
    sourceRef: input.sourceRef ?? null,
    method: input.method,
  };

  const recorded = await recordEpisode({
    kind: "business_outcome",
    phase: "value_observed",
    episodeId,
    occurredAt: input.occurredAt,
    actor: "system",
    quality: input.measurement === "MEASURED" ? "observed" : "derived",
    ...(input.direction === "cost"
      ? { cost: common }
      : {
          businessValue: {
            ...common,
            holdoutAdjusted: input.holdoutAdjusted,
            outcomeCount: input.outcomeCount ?? null,
          },
        }),
    metadata: {
      observationId: input.observationId,
      attributionRef: input.attributionRef,
      note: input.note ?? null,
      attributionContract: "value-observation-v1",
    },
  });

  if (!recorded) {
    throw new ServiceError("value observation ledger write rejected", 500);
  }

  return {
    ok: true as const,
    recorded: true as const,
    duplicate: false as const,
    episodeId,
    realityEventId: null,
  };
}

interface ParsedObservation {
  attributionRef: string;
  direction: "cost" | "value";
  category: string;
  amountCents: number;
  measurement: "MEASURED" | "ESTIMATE";
  holdoutAdjusted: boolean;
  outcomeCount: number;
}

function parseObservation(payloadRaw: unknown): ParsedObservation | null {
  const payload = objectValue(payloadRaw);
  const cost = objectValue(payload?.cost);
  const businessValue = objectValue(payload?.businessValue);
  const raw = cost ?? businessValue;
  if (!raw) return null;

  const attributionRef =
    typeof raw.attributionRef === "string" ? raw.attributionRef : null;
  const category = typeof raw.category === "string" ? raw.category : null;
  const amountCents = asFiniteInt(raw.amountCents);
  const measurement =
    raw.measurement === "MEASURED" || raw.measurement === "ESTIMATE"
      ? raw.measurement
      : null;

  if (!attributionRef || !category || amountCents === null || !measurement) {
    return null;
  }

  return {
    attributionRef,
    direction: cost ? "cost" : "value",
    category,
    amountCents,
    measurement,
    holdoutAdjusted: businessValue?.holdoutAdjusted === true,
    outcomeCount: asFiniteInt(businessValue?.outcomeCount) ?? 0,
  };
}

/**
 * Owner-level cost-per-outcome report.
 *
 * A monetary ratio is MEASURED only when the same attributionRef contains:
 *   1) measured SMS/voice cost, and
 *   2) measured, holdout-adjusted recovered revenue.
 *
 * Estimates remain visible but never get promoted into the measured ratio.
 * Missing data is named as UNMEASURED rather than rendered as zero.
 */
export async function buildCostPerOutcomeAttribution(
  windowDays = 7,
): Promise<CostPerOutcomeAttribution> {
  const boundedDays = Math.max(1, Math.min(Math.floor(windowDays), 90));
  const since = new Date(Date.now() - boundedDays * 86_400_000);
  const rows = await prisma.realityEvent.findMany({
    where: {
      eventType: "episode.business_outcome.value_observed",
      observedAt: { gte: since },
    },
    orderBy: { observedAt: "asc" },
    select: { payload: true },
  });

  const observations = rows
    .map((row) => parseObservation(row.payload))
    .filter((row): row is ParsedObservation => row !== null);

  let measuredSendCostCents = 0;
  let estimatedSendCostCents = 0;
  let measuredRecoveredRevenueCents = 0;
  let estimatedRecoveredRevenueCents = 0;

  const byRef = new Map<
    string,
    {
      measuredCostCents: number;
      measuredRevenueCents: number;
      measuredOutcomes: number;
    }
  >();

  for (const row of observations) {
    const group = byRef.get(row.attributionRef) ?? {
      measuredCostCents: 0,
      measuredRevenueCents: 0,
      measuredOutcomes: 0,
    };

    const sendCost =
      row.direction === "cost" &&
      (row.category === "sms" || row.category === "voice");
    if (sendCost) {
      if (row.measurement === "MEASURED") {
        measuredSendCostCents += row.amountCents;
        group.measuredCostCents += row.amountCents;
      } else {
        estimatedSendCostCents += row.amountCents;
      }
    }

    const recoveredRevenue =
      row.direction === "value" && row.category === "recovered_revenue";
    if (recoveredRevenue) {
      if (row.measurement === "MEASURED" && row.holdoutAdjusted) {
        measuredRecoveredRevenueCents += row.amountCents;
        group.measuredRevenueCents += row.amountCents;
        group.measuredOutcomes += row.outcomeCount;
      } else {
        estimatedRecoveredRevenueCents += row.amountCents;
      }
    }

    byRef.set(row.attributionRef, group);
  }

  let matchedRefs = 0;
  let matchedMeasuredCostCents = 0;
  let matchedMeasuredRecoveredRevenueCents = 0;
  let measuredRecoveredOutcomes = 0;

  for (const group of byRef.values()) {
    if (group.measuredCostCents <= 0 || group.measuredRevenueCents <= 0) {
      continue;
    }
    matchedRefs += 1;
    matchedMeasuredCostCents += group.measuredCostCents;
    matchedMeasuredRecoveredRevenueCents += group.measuredRevenueCents;
    measuredRecoveredOutcomes += group.measuredOutcomes;
  }

  const reasons: string[] = [];
  if (measuredSendCostCents === 0) {
    reasons.push("no measured SMS/voice cost observations");
  }
  if (measuredRecoveredRevenueCents === 0) {
    reasons.push(
      "no measured holdout-adjusted recovered revenue observations",
    );
  }
  if (
    measuredSendCostCents > 0 &&
    measuredRecoveredRevenueCents > 0 &&
    matchedRefs === 0
  ) {
    reasons.push(
      "measured cost and revenue exist, but no attributionRef joins both",
    );
  }
  if (matchedRefs > 0 && measuredRecoveredOutcomes === 0) {
    reasons.push(
      "matched money exists, but no measured recovered outcome count was supplied",
    );
  }

  const hasEstimate =
    estimatedSendCostCents > 0 || estimatedRecoveredRevenueCents > 0;
  const measurementState =
    matchedRefs > 0
      ? ("MEASURED" as const)
      : hasEstimate
        ? ("ESTIMATE" as const)
        : ("UNMEASURED" as const);

  return {
    windowDays: boundedDays,
    observedEvents: observations.length,
    measuredSendCostCents,
    estimatedSendCostCents,
    measuredRecoveredRevenueCents,
    estimatedRecoveredRevenueCents,
    matchedRefs,
    matchedMeasuredCostCents,
    matchedMeasuredRecoveredRevenueCents,
    measuredRecoveredOutcomes,
    costPerRecoveredOutcomeCents:
      measuredRecoveredOutcomes > 0
        ? Math.round(matchedMeasuredCostCents / measuredRecoveredOutcomes)
        : null,
    recoveredRevenuePerSendCostDollar:
      matchedMeasuredCostCents > 0
        ? matchedMeasuredRecoveredRevenueCents / matchedMeasuredCostCents
        : null,
    measurementState,
    reasons,
    generatedAt: new Date().toISOString(),
  };
}
