import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";

export const dynamic = "force-dynamic";

export const POST = apiHandler(
  async (req) => {
    const body = (await readRequestJson(req)) as {
      action?: string;
    };

    const { action } = body;

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
          // Process approval
          const finalStatus = "approved";
          const finalActualOutcome = proposed;
          let accuracyScore: number | null = null;

          if (item.type === "task_roi") {
            const outcomeScore = Number(finalActualOutcome.outcomeScore);
            const task = await prisma.task.update({
              where: { id: item.sourceId },
              data: { outcomeScore },
            });

            accuracyScore = Math.abs(outcomeScore - (predicted?.roiScore || 50));

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
                content: `Task ROI Calibration: Task "${task.title}" estimated ROI ${predicted?.roiScore || 50} vs actual ROI ${outcomeScore}. Class: ${classification}. Note: Bulk auto-approved (low risk)`,
                confidence: 1.0,
                source: "system:calibration",
                expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
                metadata: {
                  sourceId: item.sourceId,
                  sourceType: "Task",
                  estimatedRoi: predicted?.roiScore || 50,
                  actualRoi: outcomeScore,
                  classification,
                },
              },
              update: {
                content: `Task ROI Calibration: Task "${task.title}" estimated ROI ${predicted?.roiScore || 50} vs actual ROI ${outcomeScore}. Class: ${classification}. Note: Bulk auto-approved (low risk)`,
                expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
                metadata: {
                  sourceId: item.sourceId,
                  sourceType: "Task",
                  estimatedRoi: predicted?.roiScore || 50,
                  actualRoi: outcomeScore,
                  classification,
                },
              },
            }).catch(() => {});
          } else if (item.type === "prediction") {
            const approvedStatus = finalActualOutcome.status;
            const outcomeDescription = finalActualOutcome.outcomeDescription || "";

            let brier: number | null = null;
            const outcomeVal = approvedStatus === "confirmed" ? 1 : 0;
            brier = (item.confidence - outcomeVal) ** 2;
            accuracyScore = brier;

            const pred = await prisma.prediction.update({
              where: { id: item.sourceId },
              data: {
                status: approvedStatus,
                outcome: outcomeDescription,
                brierScore: brier,
              },
            });

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
                expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
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
                expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
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

          await prisma.calibrationReviewItem.update({
            where: { id: item.id },
            data: {
              status: finalStatus,
              approvedActualOutcome: finalActualOutcome,
              accuracyScore,
              correctionNote: "Bulk auto-approved (low risk)",
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

    return {
      success: true,
      processedCount,
    };
  },
  { auth: "owner" }
);
