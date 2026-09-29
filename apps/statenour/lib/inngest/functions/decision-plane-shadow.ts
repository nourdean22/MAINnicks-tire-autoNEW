/**
 * Decision Plane shadow evaluator.
 *
 * Candidate backends run durably OUTSIDE the chat response path and have zero
 * authority. The only durable write is a typed Decision Episode containing
 * distributions + baseline agreement; raw user state is never persisted there.
 */
import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { getConfiguredDecisionBackends } from "@/lib/ai/decision-plane/backends";
import { evaluateDecisionPlane } from "@/lib/ai/decision-plane/system-one-http";
import {
  TURN_DECISION_QUESTIONS,
  compareTurnDecision,
  type TurnDecisionQuestions,
} from "@/lib/ai/decision-plane/turn-schema";
import { TurnDecisionShadowEventSchema } from "@/lib/ai/decision-plane/shadow";
import type { DecisionRequest } from "@/lib/ai/decision-plane/types";
import { recordEpisode } from "@/lib/intelligence/episodes";
import { logError } from "@/lib/utils/error-log";

const inngest = getInngest();

export const decisionPlaneShadow = inngest.createFunction(
  {
    id: "decision-plane-shadow",
    name: "Decision Plane · sampled shadow evaluation",
    retries: 1,
    triggers: [{ event: "decision-plane/shadow.requested" }],
    onFailure: onInngestFailure,
  },
  async ({ event, step }) => {
    const input = TurnDecisionShadowEventSchema.parse(event.data);
    const backends = getConfiguredDecisionBackends();
    const summaries: Array<Record<string, unknown>> = [];

    for (const backend of backends) {
      let result: Awaited<ReturnType<typeof evaluateDecisionPlane<TurnDecisionQuestions>>>;
      try {
        result = await step.run(`evaluate-${backend.id}`, () => {
          const request: DecisionRequest<TurnDecisionQuestions> = {
            state: input.state,
            questions: TURN_DECISION_QUESTIONS,
          };
          return evaluateDecisionPlane(backend, request);
        });
      } catch (err) {

        const errorClass = err instanceof Error ? err.name : "Error";
        await step.run(`record-${backend.id}-failure`, () =>
          recordEpisode({
            kind: "decision",
            phase: "shadow_failed",
            episodeId: `${input.traceId}:${backend.id}`,
            traceId: input.traceId,
            conversationId: input.conversationId,
            inputHash: input.inputHash,
            quality: "derived",
            decision: { backend: backend.id },
            outcome: { ok: false, errorClass },
            metadata: { trust: backend.trust },
          }),
        );
        logError("decision-plane.shadow", err as Error, {
          fn: "decisionPlaneShadow",
          backend: backend.id,
          traceId: input.traceId,
        }, "warn");
        summaries.push({ backend: backend.id, ok: false, errorClass });
        continue;
      }

      const comparison = compareTurnDecision(result, input.incumbent);
      await step.run(`record-${backend.id}-success`, () =>
        recordEpisode({
          kind: "decision",
          phase: "shadow_evaluated",
          episodeId: `${input.traceId}:${backend.id}`,
          traceId: input.traceId,
          conversationId: input.conversationId,
          inputHash: input.inputHash,
          quality: "derived",
          decision: {
            backend: backend.id,
            model: result.model,
            answers: result.answers,
          },

          outcome: {
            ok: true,
            // Incumbent agreement is a comparison baseline, NOT ground truth.
            incumbentAgreement: comparison,
          },
          latencyMs: result.latencyMs,
          metadata: {
            trust: backend.trust,
            usage: result.usage,
            requestId: result.requestId ?? null,
            stateTruncated: input.state.truncated,
            incumbent: input.incumbent,
          },
        }),
      );

      summaries.push({
        backend: backend.id,
        ok: true,
        model: result.model,
        latencyMs: result.latencyMs,
        incumbentAgreementRate: comparison.agreementRate,
      });
    }

    return {
      traceId: input.traceId,
      evaluatedBackends: backends.length,
      summaries,
    };
  },
);
