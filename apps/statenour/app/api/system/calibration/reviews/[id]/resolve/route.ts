import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";

export const dynamic = "force-dynamic";

export const POST = apiHandler(
  async (req, { params }) => {
    const { id } = await params!;
    const body = (await readRequestJson(req)) as {
      action?: string;
      approvedActualOutcome?: any;
      correctionNote?: string;
    };

    const { action, approvedActualOutcome, correctionNote } = body;

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

    return {
      success: true,
      item: updatedItem,
    };
  },
  { auth: "owner" }
);
