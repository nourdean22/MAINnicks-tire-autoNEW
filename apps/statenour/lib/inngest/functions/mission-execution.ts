/**
 * Durable mission execution v1.
 *
 * This is deliberately narrow: only checkpoint + deep-research steps are
 * executable. It proves resumable multi-step work without giving an LLM a
 * generic arbitrary-action runner. Mission lifecycle state is NOT mutated.
 */
import { createHash } from "node:crypto";
import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import {
  DurableMissionEventSchema,
  hashMissionText,
} from "@/lib/missions/durable-execution";
import { recordEpisode } from "@/lib/intelligence/episodes";

const inngest = getInngest();

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export const durableMissionExecution = inngest.createFunction(
  {
    id: "durable-mission-execution",
    name: "Mission · durable bounded execution",
    retries: 1,
    triggers: [{ event: "mission/execution.requested" }],
    onFailure: onInngestFailure,
  },
  async ({ event, step }) => {
    const input = DurableMissionEventSchema.parse(event.data);
    const objectiveHash = hashMissionText(input.objective);

    const writeEpisode = async (
      phase: string,
      metadata?: Record<string, unknown>,
      outcome?: Record<string, unknown>,
    ) => recordEpisode({
      kind: "mission",
      phase,
      episodeId: input.runId,
      missionId: input.missionId,
      actor: input.requestedBy,
      inputHash: objectiveHash,
      metadata,
      outcome,
    });

    try {
      await step.run("record-run-started", () =>
        writeEpisode("started", { stepCount: input.steps.length }),
      );

      const results: Array<Record<string, unknown>> = [];
      for (let index = 0; index < input.steps.length; index += 1) {
        const missionStep = input.steps[index]!;
        const stepKey = `${index}-${missionStep.id}`;
        await step.run(`record-${stepKey}-started`, () =>
          writeEpisode("step_started", {
            stepId: missionStep.id,
            stepKind: missionStep.kind,
            stepIndex: index,
            totalSteps: input.steps.length,
          }),
        );

        let result: Record<string, unknown>;
        if (missionStep.kind === "checkpoint") {
          result = await step.run(`execute-${stepKey}-checkpoint`, async () => ({
            kind: "checkpoint",
            checkpointed: true,
          }));
        } else {
          result = await step.run(`execute-${stepKey}-research`, async () => {
            const { runDeepResearch } = await import("@/lib/ai/deep-research");
            const report = await runDeepResearch({ question: missionStep.question });
            return {
              kind: "research",
              questionHash: hashText(missionStep.question),
              cached: report.cached ?? false,
              citationCount: report.allCitations.length,
              synthesisChars: report.synthesis?.length ?? 0,
              synthesisStatus: report.synthesisStatus,
              synthesisHash: report.synthesis ? hashText(report.synthesis) : null,
            };
          });
        }

        results.push(result);
        await step.run(`record-${stepKey}-completed`, () =>
          writeEpisode("step_completed", {
            stepId: missionStep.id,
            stepKind: missionStep.kind,
            stepIndex: index,
            totalSteps: input.steps.length,
          }, result),
        );
      }

      await step.run("record-run-completed", () =>
        writeEpisode("completed", { stepCount: input.steps.length }, {
          completedSteps: input.steps.length,
        }),
      );

      return {
        runId: input.runId,
        missionId: input.missionId,
        completedSteps: input.steps.length,
        results,
      };
    } catch (err) {
      await step.run("record-run-attempt-failed", () =>
        writeEpisode("attempt_failed", undefined, {
          errorClass: err instanceof Error ? err.name : "Error",
        }),
      ).catch(() => undefined);
      throw err;
    }
  },
);
