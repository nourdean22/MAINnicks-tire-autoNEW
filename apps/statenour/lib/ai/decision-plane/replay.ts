import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";
import { recordEpisode } from "@/lib/intelligence/episodes";
import { TURN_DECISION_QUESTIONS } from "./turn-schema";
import {
  binaryBrierScore,
  categoricalLogLoss,
  expectedCalibrationError,
  multiclassBrier,
  type CategoricalCalibrationSample,
} from "./calibration";

export const DecisionOutcomeAnswersSchema = z
  .record(
    z.string().min(1),
    z.union([z.string(), z.boolean(), z.number().finite()]),
  )
  .refine((value) => Object.keys(value).length > 0, "at least one observed answer is required");

export const RecordDecisionPlaneOutcomeSchema = z.object({
  episodeId: z.string().min(3).max(240),
  observedAnswers: DecisionOutcomeAnswersSchema,
  note: z.string().trim().max(1000).optional(),
});

export type RecordDecisionPlaneOutcomeInput = z.infer<
  typeof RecordDecisionPlaneOutcomeSchema
>;

function questionFor(key: string) {
  return TURN_DECISION_QUESTIONS[key as keyof typeof TURN_DECISION_QUESTIONS];
}

function assertObservedAnswer(key: string, value: string | boolean | number): void {
  const question = questionFor(key);
  if (!question) throw new ServiceError(`unknown decision question: ${key}`, 400);

  if (question.type === "noul") {
    if (typeof value !== "boolean") {
      throw new ServiceError(`observed answer ${key} must be boolean`, 400);
    }
    return;
  }

  if (question.type === "choice") {
    if (typeof value !== "string" || !(value in question.criteria)) {
      throw new ServiceError(`observed answer ${key} is not a valid choice`, 400);
    }
    return;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value >= question.criteria.length
  ) {
    throw new ServiceError(`observed answer ${key} is outside its score rubric`, 400);
  }
}

/**
 * Append an observed outcome to an existing shadow Decision Episode.
 *
 * This does not mutate the candidate decision. Corrections append another
 * outcome_observed event with the same episodeId; replay uses the latest label
 * in the selected window, preserving the full history in RealityEvent.
 */
export async function recordDecisionPlaneOutcome(
  rawInput: RecordDecisionPlaneOutcomeInput,
): Promise<{ ok: true; episodeId: string; recorded: true }> {
  const input = RecordDecisionPlaneOutcomeSchema.parse(rawInput);
  for (const [key, value] of Object.entries(input.observedAnswers)) {
    assertObservedAnswer(key, value);
  }

  const candidate = await prisma.realityEvent.findFirst({
    where: {
      eventType: "episode.decision.shadow_evaluated",
      payload: { path: ["episodeId"], equals: input.episodeId },
    },
    select: { id: true },
  });
  if (!candidate) {
    throw new ServiceError(`decision episode ${input.episodeId} not found`, 404);
  }

  const recorded = await recordEpisode({
    kind: "decision",
    phase: "outcome_observed",
    episodeId: input.episodeId,
    actor: "operator",
    quality: "observed",
    outcome: {
      observedAnswers: input.observedAnswers,
      note: input.note ?? null,
      labelSource: "operator",
    },
    metadata: {
      candidateRealityEventId: candidate.id,
      questionSet: "turn-decision-v1",
    },
  });
  if (!recorded) {
    throw new ServiceError("decision outcome ledger write rejected", 500);
  }

  return { ok: true, episodeId: input.episodeId, recorded: true };
}

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

interface ScoredAnswer {
  brier: number;
  logLoss: number;
  categoricalSample?: CategoricalCalibrationSample;
}

function scoreAnswer(answer: unknown, observed: unknown): ScoredAnswer | null {
  const a = objectValue(answer);
  const type = typeof a?.type === "string" ? a.type : null;

  if (type === "noul" && typeof observed === "boolean") {
    const p = finiteNumber(a?.noul);
    if (p === null || p < 0 || p > 1) return null;
    const y: 0 | 1 = observed ? 1 : 0;
    const observedProbability = observed ? p : 1 - p;
    return {
      brier: binaryBrierScore(p, y),
      logLoss: -Math.log(Math.max(observedProbability, 1e-12)),
    };
  }

  if ((type === "choice" || type === "score") && (typeof observed === "string" || typeof observed === "number")) {
    const probabilities = objectValue(a?.probabilities);
    if (!probabilities) return null;

    const numeric: Record<string, number> = {};
    for (const [key, value] of Object.entries(probabilities)) {
      const n = finiteNumber(value);
      if (n === null) return null;
      numeric[key] = n;
    }

    const label = String(observed);
    const brier = multiclassBrier(numeric, label);
    const logLoss = categoricalLogLoss(numeric, label);
    if (brier === null || logLoss === null) return null;
    return {
      brier,
      logLoss,
      categoricalSample: { probabilities: numeric, observed: label },
    };
  }

  return null;
}

export interface DecisionReplayBackendRollup {
  backend: string;
  evaluatedEpisodes: number;
  labeledEpisodes: number;
  scoredAnswers: number;
  labelCoverageRate: number;
  meanBrier: number | null;
  meanLogLoss: number | null;
  categoricalEce: number | null;
  lastEvaluatedAt: string | null;
}

export interface DecisionPlaneReplayReport {
  windowDays: number;
  evaluatedEpisodes: number;
  labeledEpisodes: number;
  unlabeledEpisodes: number;
  scoredAnswers: number;
  rollups: DecisionReplayBackendRollup[];
  generatedAt: string;
  promotionReady: false;
  caveat: string;
}

/**
 * Score only shadow decisions that have explicit observed labels.
 *
 * Window semantics are intentionally simple and inspectable: both the candidate
 * and its latest outcome_observed label must be present in the selected window.
 * Unlabeled episodes are counted, never coerced into a negative outcome.
 */
export async function buildDecisionPlaneReplayReport(
  windowDays = 30,
): Promise<DecisionPlaneReplayReport> {
  const boundedDays = Math.max(1, Math.min(Math.floor(windowDays), 90));
  const since = new Date(Date.now() - boundedDays * 86_400_000);
  const rows = await prisma.realityEvent.findMany({
    where: {
      eventType: {
        in: [
          "episode.decision.shadow_evaluated",
          "episode.decision.outcome_observed",
        ],
      },
      observedAt: { gte: since },
    },
    orderBy: { observedAt: "asc" },
    select: { eventType: true, observedAt: true, payload: true },
  });

  const latestLabels = new Map<string, JsonObject>();
  for (const row of rows) {
    if (row.eventType !== "episode.decision.outcome_observed") continue;
    const payload = objectValue(row.payload);
    const episodeId = typeof payload?.episodeId === "string" ? payload.episodeId : null;
    const outcome = objectValue(payload?.outcome);
    const observedAnswers = objectValue(outcome?.observedAnswers);
    if (episodeId && observedAnswers) latestLabels.set(episodeId, observedAnswers);
  }

  type Group = {
    evaluatedEpisodes: number;
    labeledEpisodes: number;
    briers: number[];
    logLosses: number[];
    categorical: CategoricalCalibrationSample[];
    lastEvaluatedAt: Date | null;
  };
  const groups = new Map<string, Group>();
  let evaluatedEpisodes = 0;
  let labeledEpisodes = 0;
  let scoredAnswers = 0;

  for (const row of rows) {
    if (row.eventType !== "episode.decision.shadow_evaluated") continue;
    const payload = objectValue(row.payload);
    const episodeId = typeof payload?.episodeId === "string" ? payload.episodeId : null;
    const decision = objectValue(payload?.decision);
    const backend = typeof decision?.backend === "string" ? decision.backend : "unknown";
    const answers = objectValue(decision?.answers);
    evaluatedEpisodes += 1;

    const group = groups.get(backend) ?? {
      evaluatedEpisodes: 0,
      labeledEpisodes: 0,
      briers: [],
      logLosses: [],
      categorical: [],
      lastEvaluatedAt: null,
    };
    group.evaluatedEpisodes += 1;
    if (!group.lastEvaluatedAt || row.observedAt > group.lastEvaluatedAt) {
      group.lastEvaluatedAt = row.observedAt;
    }

    const observedAnswers = episodeId ? latestLabels.get(episodeId) : undefined;
    let scoredThisEpisode = 0;
    if (answers && observedAnswers) {
      for (const [key, observed] of Object.entries(observedAnswers)) {
        if (!(key in answers)) continue;
        const scored = scoreAnswer(answers[key], observed);
        if (!scored) continue;
        group.briers.push(scored.brier);
        group.logLosses.push(scored.logLoss);
        if (scored.categoricalSample) group.categorical.push(scored.categoricalSample);
        scoredThisEpisode += 1;
        scoredAnswers += 1;
      }
    }

    if (scoredThisEpisode > 0) {
      group.labeledEpisodes += 1;
      labeledEpisodes += 1;
    }
    groups.set(backend, group);
  }

  const rollups = [...groups.entries()]
    .map(([backend, group]): DecisionReplayBackendRollup => {
      const ece = expectedCalibrationError(group.categorical);
      return {
        backend,
        evaluatedEpisodes: group.evaluatedEpisodes,
        labeledEpisodes: group.labeledEpisodes,
        scoredAnswers: group.briers.length,
        labelCoverageRate:
          group.evaluatedEpisodes === 0
            ? 0
            : group.labeledEpisodes / group.evaluatedEpisodes,
        meanBrier:
          group.briers.length === 0
            ? null
            : group.briers.reduce((sum, value) => sum + value, 0) /
              group.briers.length,
        meanLogLoss:
          group.logLosses.length === 0
            ? null
            : group.logLosses.reduce((sum, value) => sum + value, 0) /
              group.logLosses.length,
        categoricalEce: ece.ece,
        lastEvaluatedAt: group.lastEvaluatedAt?.toISOString() ?? null,
      };
    })
    .sort(
      (a, b) =>
        b.labeledEpisodes - a.labeledEpisodes ||
        b.evaluatedEpisodes - a.evaluatedEpisodes ||
        a.backend.localeCompare(b.backend),
    );

  return {
    windowDays: boundedDays,
    evaluatedEpisodes,
    labeledEpisodes,
    unlabeledEpisodes: evaluatedEpisodes - labeledEpisodes,
    scoredAnswers,
    rollups,
    generatedAt: new Date().toISOString(),
    promotionReady: false,
    caveat:
      "Replay scores use only explicit observed labels. Unlabeled episodes are excluded from scoring, and no score automatically grants production authority.",
  };
}
