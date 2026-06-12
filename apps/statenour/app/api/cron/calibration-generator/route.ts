/**
 * GET /api/cron/calibration-generator
 *
 * Nightly cron that generates Calibration Review Items for completed high-impact tasks
 * and predictions that have reached their target dates.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { proposeTaskRoi, proposePredictionOutcome } from "@/lib/brain/calibration-engine";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/calibration-generator");

export const maxDuration = 120; // Pro plan limit

export const GET = cronHandler(async () => {
  const results: Record<string, any> = {
    predictions: { scanned: 0, created: 0, errors: 0 },
    tasks: { scanned: 0, created: 0, errors: 0 },
  };

  const todayStr = new Date().toISOString().slice(0, 10);
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

  // 1. Process Predictions
  try {
    const pendingPredictions = await prisma.prediction.findMany({
      where: {
        status: "pending",
        targetDate: { lte: todayStr },
      },
      take: 20,
    });

    results.predictions.scanned = pendingPredictions.length;

    for (const pred of pendingPredictions) {
      try {
        const proposal = await proposePredictionOutcome(pred);

        await prisma.calibrationReviewItem.upsert({
          where: {
            sourceId_sourceType: {
              sourceId: pred.id,
              sourceType: "Prediction",
            },
          },
          create: {
            type: "prediction",
            sourceId: pred.id,
            sourceType: "Prediction",
            status: "pending",
            predictedOutcome: {
              status: "confirmed",
              confidence: pred.confidence,
              prediction: pred.prediction,
            },
            proposedActualOutcome: {
              status: proposal.status,
              outcomeDescription: proposal.outcomeDescription,
            },
            confidence: pred.confidence,
            evidence: proposal.evidence,
            evidenceFreshness: new Date(),
          },
          update: {
            // Re-run proposed outcome if still pending
            proposedActualOutcome: {
              status: proposal.status,
              outcomeDescription: proposal.outcomeDescription,
            },
            evidence: proposal.evidence,
            evidenceFreshness: new Date(),
          },
        });

        results.predictions.created++;
      } catch (err) {
        results.predictions.errors++;
        log.error("prediction_processing_failed", {
          predictionId: pred.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    results.predictions.error = err instanceof Error ? err.message : String(err);
    log.error("prediction_scan_failed", { error: results.predictions.error });
  }

  // 2. Process High-Impact Completed Tasks
  try {
    const completedTasks = await prisma.task.findMany({
      where: {
        status: "DONE",
        updatedAt: { gte: fortyEightHoursAgo },
        deletedAt: null,
        OR: [
          { goalId: { not: null } },
          { roiScore: { gte: 70 } },
          { proof: { not: Prisma.DbNull } },
        ],
      },
      take: 20,
    });

    results.tasks.scanned = completedTasks.length;

    for (const task of completedTasks) {
      try {
        const proposal = await proposeTaskRoi(task);

        await prisma.calibrationReviewItem.upsert({
          where: {
            sourceId_sourceType: {
              sourceId: task.id,
              sourceType: "Task",
            },
          },
          create: {
            type: "task_roi",
            sourceId: task.id,
            sourceType: "Task",
            status: "pending",
            predictedOutcome: {
              roiScore: task.roiScore,
              title: task.title,
              effort: task.effort,
            },
            proposedActualOutcome: {
              outcomeScore: proposal.outcomeScore,
              classification: proposal.classification,
              rationale: proposal.rationale,
            },
            confidence: 0.5,
            evidence: {
              actualMinutes: task.actualMinutes,
              completionNote: task.completionNote,
              proof: task.proof,
            },
            evidenceFreshness: new Date(),
          },
          update: {
            proposedActualOutcome: {
              outcomeScore: proposal.outcomeScore,
              classification: proposal.classification,
              rationale: proposal.rationale,
            },
            evidence: {
              actualMinutes: task.actualMinutes,
              completionNote: task.completionNote,
              proof: task.proof,
            },
            evidenceFreshness: new Date(),
          },
        });

        results.tasks.created++;
      } catch (err) {
        results.tasks.errors++;
        log.error("task_processing_failed", {
          taskId: task.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    results.tasks.error = err instanceof Error ? err.message : String(err);
    log.error("task_scan_failed", { error: results.tasks.error });
  }

  return results;
});
