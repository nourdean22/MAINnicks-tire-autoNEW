import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";
import { calculateScoreboardStats } from "@/lib/brain/calibration-engine";
import type { CalibrationReviewItem, Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;
type LessonUpsert = Prisma.BrainMemoryUpsertArgs;

/**
 * The one writer for a low-risk approval's source row: Task.outcomeScore, or a
 * Prediction's status, outcome and Brier score. Used by the bulk tap and by the
 * allowlist auto-resolver (calibration-auto-resolve.ts), which runs it inside its
 * claim transaction, so nothing here swallows an error. The lesson memory is
 * returned, not written: a failed statement inside a Postgres transaction aborts
 * it even when caught, so the caller writes the lesson after commit.
 */
export async function applyLowRiskOutcome(
  db: Db,
  item: CalibrationReviewItem,
  note: string,
): Promise<{ accuracyScore: number | null; lesson: LessonUpsert }> {
  const proposed = item.proposedActualOutcome as any;
  const predicted = item.predictedOutcome as any;
  const ttl = () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  if (item.type === "task_roi") {
    const outcomeScore = Number(proposed.outcomeScore);
    const task = await db.task.update({
      where: { id: item.sourceId },
      data: { outcomeScore },
    });
    const accuracyScore = Math.abs(outcomeScore - (predicted?.roiScore || 50));
    const classification = proposed.classification || "accurate";
    const content = `Task ROI Calibration: Task "${task.title}" estimated ROI ${predicted?.roiScore || 50} vs actual ROI ${outcomeScore}. Class: ${classification}. Note: ${note}`;
    const metadata = {
      sourceId: item.sourceId,
      sourceType: "Task",
      estimatedRoi: predicted?.roiScore || 50,
      actualRoi: outcomeScore,
      classification,
    };
    const key = `task-roi-${item.sourceId}`;
    return {
      accuracyScore,
      lesson: {
        where: { category_key: { category: "prediction_lesson", key } },
        create: { category: "prediction_lesson", key, content, confidence: 1.0, source: "system:calibration", expiresAt: ttl(), metadata },
        update: { content, expiresAt: ttl(), metadata },
      },
    };
  }

  const approvedStatus = proposed.status;
  const outcomeDescription = proposed.outcomeDescription || "";
  const outcomeVal = approvedStatus === "confirmed" ? 1 : 0;
  const brier = (item.confidence - outcomeVal) ** 2;
  const pred = await db.prediction.update({
    where: { id: item.sourceId },
    data: { status: approvedStatus, outcome: outcomeDescription, brierScore: brier },
  });
  const content = `Prediction Calibration: Prediction "${pred.prediction}" (confidence: ${pred.confidence}) resolved as ${approvedStatus}. Brier: ${brier !== null ? brier.toFixed(3) : "N/A"}. Outcome: ${outcomeDescription}`;
  const metadata = {
    sourceId: item.sourceId,
    sourceType: "Prediction",
    confidence: pred.confidence,
    approvedStatus,
    brierScore: brier,
  };
  const key = `pred-calib-${item.sourceId}`;
  return {
    accuracyScore: brier,
    lesson: {
      where: { category_key: { category: "prediction_lesson", key } },
      create: { category: "prediction_lesson", key, content, confidence: pred.confidence, source: "system:calibration", expiresAt: ttl(), metadata },
      update: { content, expiresAt: ttl(), metadata },
    },
  };
}

/** Best effort, as before the extraction: a lesson write never fails a resolution. */
export async function writeCalibrationLesson(lesson: LessonUpsert): Promise<void> {
  await prisma.brainMemory.upsert(lesson).catch(() => {});
}

export async function getCalibrationReviews() {
  const pending = await prisma.calibrationReviewItem.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "desc" },
  });

  const history = await prisma.calibrationReviewItem.findMany({
    where: { status: { in: ["approved", "corrected", "rejected"] } },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  const lessons = await prisma.brainMemory.findMany({
    where: {
      category: "prediction_lesson",
      deletedAt: null,
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const scoreboard = await calculateScoreboardStats();

  return { pending, history, lessons, scoreboard };
}

export async function resolveCalibrationReview(
  id: string,
  action: string,
  approvedActualOutcome?: any,
  correctionNote?: string
) {
  if (!action || !["approve", "correct", "reject", "needs_more_evidence"].includes(action)) {
    throw new ServiceError(
      `Invalid action: must be "approve", "correct", "reject", or "needs_more_evidence"`,
      400
    );
  }

  const item = await prisma.calibrationReviewItem.findUnique({
    where: { id },
  });

  if (!item) {
    throw new ServiceError(`Calibration review item not found: ${id}`, 404);
  }

  if (item.status !== "pending") {
    throw new ServiceError(`Calibration review item is already in status "${item.status}"`, 409);
  }

  let finalStatus = "pending";
  let finalActualOutcome: any = null;
  let accuracyScore: number | null = null;

  if (action === "reject") {
    finalStatus = "rejected";
  } else if (action === "needs_more_evidence") {
    finalStatus = "needs_more_evidence";
  } else {
    // approve or correct
    finalStatus = action === "approve" ? "approved" : "corrected";
    finalActualOutcome = action === "approve" ? item.proposedActualOutcome : approvedActualOutcome;

    if (!finalActualOutcome) {
      throw new ServiceError(`Actual outcome must be provided for action "${action}"`, 400);
    }

    // Execute side-effects on source models
    if (item.sourceType === "Task") {
      const outcomeScore = Number(finalActualOutcome.outcomeScore);
      if (isNaN(outcomeScore) || outcomeScore < 1 || outcomeScore > 100) {
        throw new ServiceError("Task outcome score must be an integer between 1 and 100", 400);
      }

      // Update the Task
      const task = await prisma.task.update({
        where: { id: item.sourceId },
        data: { outcomeScore },
      });

      // Compute error for accuracyScore (absolute error normalized)
      const pred = item.predictedOutcome as { roiScore: number };
      accuracyScore = Math.abs(outcomeScore - (pred?.roiScore || 50));

      // Create lesson memory
      const classification = finalActualOutcome.classification || "accurate";
      await prisma.brainMemory.upsert({
        where: {
          category_key: {
            category: "prediction_lesson",
            key: `task-roi-${item.sourceId}`,
          },
        },
        create: {
          category: "prediction_lesson",
          key: `task-roi-${item.sourceId}`,
          content: `Task ROI Calibration: Task "${task.title}" estimated ROI ${pred?.roiScore || 50} vs actual ROI ${outcomeScore}. Class: ${classification}. Note: ${correctionNote || finalActualOutcome.rationale || ""}`,
          confidence: 1.0,
          source: "system:calibration",
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90-day TTL
          metadata: {
            sourceId: item.sourceId,
            sourceType: "Task",
            estimatedRoi: pred?.roiScore || 50,
            actualRoi: outcomeScore,
            classification,
          },
        },
        update: {
          content: `Task ROI Calibration: Task "${task.title}" estimated ROI ${pred?.roiScore || 50} vs actual ROI ${outcomeScore}. Class: ${classification}. Note: ${correctionNote || finalActualOutcome.rationale || ""}`,
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90-day TTL
          metadata: {
            sourceId: item.sourceId,
            sourceType: "Task",
            estimatedRoi: pred?.roiScore || 50,
            actualRoi: outcomeScore,
            classification,
          },
        },
      }).catch(() => {});

    } else if (item.sourceType === "Prediction") {
      const approvedStatus = finalActualOutcome.status; // "confirmed" | "disproven" | "expired"
      const outcomeDescription = finalActualOutcome.outcomeDescription || "";

      if (!approvedStatus || !["confirmed", "disproven", "expired"].includes(approvedStatus)) {
        throw new ServiceError(`Invalid prediction status resolution: "${approvedStatus}"`, 400);
      }

      // Compute Brier score
      let brier: number | null = null;
      if (approvedStatus !== "expired") {
        const outcomeVal = approvedStatus === "confirmed" ? 1 : 0;
        brier = (item.confidence - outcomeVal) ** 2;
        accuracyScore = brier;
      }

      // Update the Prediction
      const pred = await prisma.prediction.update({
        where: { id: item.sourceId },
        data: {
          status: approvedStatus,
          outcome: outcomeDescription,
          brierScore: brier,
        },
      });

      // Create lesson memory
      await prisma.brainMemory.upsert({
        where: {
          category_key: {
            category: "prediction_lesson",
            key: `pred-calib-${item.sourceId}`,
          },
        },
        create: {
          category: "prediction_lesson",
          key: `pred-calib-${item.sourceId}`,
          content: `Prediction Calibration: Prediction "${pred.prediction}" (confidence: ${pred.confidence}) resolved as ${approvedStatus}. Brier: ${brier !== null ? brier.toFixed(3) : "N/A"}. Outcome: ${outcomeDescription}`,
          confidence: pred.confidence,
          source: "system:calibration",
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90-day TTL
          metadata: {
            sourceId: item.sourceId,
            sourceType: "Prediction",
            confidence: pred.confidence,
            approvedStatus,
            brierScore: brier,
          },
        },
        update: {
          content: `Prediction Calibration: Prediction "${pred.prediction}" (confidence: ${pred.confidence}) resolved as ${approvedStatus}. Brier: ${brier !== null ? brier.toFixed(3) : "N/A"}. Outcome: ${outcomeDescription}`,
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90-day TTL
          metadata: {
            sourceId: item.sourceId,
            sourceType: "Prediction",
            confidence: pred.confidence,
            approvedStatus,
            brierScore: brier,
          },
        },
      }).catch(() => {});
    }
  }

  // Update the review item status
  const updatedItem = await prisma.calibrationReviewItem.update({
    where: { id },
    data: {
      status: finalStatus,
      approvedActualOutcome: finalActualOutcome,
      accuracyScore,
      correctionNote,
      reviewedAt: new Date(),
      reviewedBy: "owner",
    },
  });

  return updatedItem;
}

export async function bulkResolveCalibrationReviews(action: string) {
  if (!action || !["approve_low_risk", "reject_stale"].includes(action)) {
    throw new ServiceError(
      `Invalid action: must be "approve_low_risk" or "reject_stale"`,
      400
    );
  }

  let processedCount = 0;

  if (action === "approve_low_risk") {
    // Fetch all pending reviews
    const pendingItems = await prisma.calibrationReviewItem.findMany({
      where: { status: "pending" },
    });

    for (const item of pendingItems) {
      const proposed = item.proposedActualOutcome as any;
      const predicted = item.predictedOutcome as any;

      let shouldApprove = false;

      if (item.type === "task_roi" && proposed?.outcomeScore !== undefined && predicted?.roiScore !== undefined) {
        const diff = Math.abs(proposed.outcomeScore - predicted.roiScore);
        if (diff <= 5) {
          shouldApprove = true;
        }
      } else if (item.type === "prediction" && proposed?.status && ["confirmed", "disproven"].includes(proposed.status)) {
        shouldApprove = true;
      }

      if (shouldApprove) {
        const note = "Bulk auto-approved (low risk)";
        const { accuracyScore, lesson } = await applyLowRiskOutcome(prisma, item, note);
        await writeCalibrationLesson(lesson);

        await prisma.calibrationReviewItem.update({
          where: { id: item.id },
          data: {
            status: "approved",
            approvedActualOutcome: item.proposedActualOutcome as Prisma.InputJsonValue,
            accuracyScore,
            correctionNote: note,
            reviewedAt: new Date(),
            reviewedBy: "owner",
          },
        });

        processedCount++;
      }
    }
  } else if (action === "reject_stale") {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const staleRes = await prisma.calibrationReviewItem.updateMany({
      where: {
        status: "pending",
        createdAt: { lt: fourteenDaysAgo },
      },
      data: {
        status: "rejected",
        reviewedAt: new Date(),
        reviewedBy: "owner",
        correctionNote: "Bulk rejected (stale >14 days)",
      },
    });
    processedCount = staleRes.count;
  }

  return { processedCount };
}
