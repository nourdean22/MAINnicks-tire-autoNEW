/**
 * Closed-Loop Outcome Calibration Engine · v1.0.0
 *
 * Connects predictions, task ROI estimates, actual execution duration/notes,
 * and business signals to propose calibration review items.
 */

import { prisma } from "@/lib/prisma";
import { getEmbedding } from "@/lib/ai/provider";
import { queryNick } from "@/lib/nickstire/query";
import { logger as rootLogger } from "@/lib/logger";
import { Task, Prediction, EffortBand } from "@prisma/client";

const log = rootLogger.withSurface("brain/calibration-engine");

const TARGET_DIM = 1536;
const SIM_THRESHOLD_HIGH = 0.72;
const KNN_TOP = 10;

const POSITIVE_PATTERNS = [
  /\bachieved\b/i,
  /\bhit\b/i,
  /\bexceeded\b/i,
  /\bsucceeded\b/i,
  /\bcrushed\b/i,
  /\bnailed\b/i,
  /\bon target\b/i,
  /\bon time\b/i,
  /\bconfirmed\b/i,
  /\bworked\b/i,
  /\bsuccess\b/i,
];

const NEGATIVE_PATTERNS = [
  /\bmissed\b/i,
  /\bfailed\b/i,
  /\bfell short\b/i,
  /\bdidn'?t\b/i,
  /\bcouldn'?t\b/i,
  /\bopposite\b/i,
  /\bbusted\b/i,
  /\bdisproven\b/i,
  /\bwrong\b/i,
];

const EFFORT_MINUTES_MAP: Record<EffortBand, number> = {
  M5: 5,
  M15: 15,
  M30: 30,
  H1: 60,
  H2PLUS: 120,
};

function padToTargetDim(arr: number[]): number[] {
  if (arr.length === TARGET_DIM) return arr;
  if (arr.length > TARGET_DIM) return arr.slice(0, TARGET_DIM);
  return [...arr, ...new Array(TARGET_DIM - arr.length).fill(0)];
}

interface ProposedTaskOutcome {
  outcomeScore: number;
  classification: "overestimated" | "underestimated" | "accurate" | "insufficient_evidence";
  rationale: string;
}

/**
 * Propose actual outcome score and classification for a completed task.
 */
export async function proposeTaskRoi(task: Task): Promise<ProposedTaskOutcome> {
  const baseRoi = task.roiScore; // 1 to 100
  let proposedScore = baseRoi;
  const rationaleParts: string[] = [];

  const actualMin = task.actualMinutes || 0;
  const expectedMin = EFFORT_MINUTES_MAP[task.effort] || 30;

  // 1. Duration heuristic
  if (actualMin > 0) {
    const ratio = actualMin / expectedMin;
    if (ratio >= 2.0) {
      proposedScore = Math.max(1, proposedScore * 0.7);
      rationaleParts.push(`Took ${actualMin}m vs estimated ${expectedMin}m (ratio: ${ratio.toFixed(1)}x, ROI penalized)`);
    } else if (ratio >= 1.5) {
      proposedScore = Math.max(1, proposedScore * 0.85);
      rationaleParts.push(`Took ${actualMin}m vs estimated ${expectedMin}m (ratio: ${ratio.toFixed(1)}x, ROI reduced)`);
    } else if (ratio <= 0.5) {
      proposedScore = Math.min(100, proposedScore * 1.25);
      rationaleParts.push(`Finished in ${actualMin}m vs estimated ${expectedMin}m (ratio: ${ratio.toFixed(1)}x, ROI boosted)`);
    } else if (ratio <= 0.75) {
      proposedScore = Math.min(100, proposedScore * 1.1);
      rationaleParts.push(`Finished in ${actualMin}m vs estimated ${expectedMin}m (ratio: ${ratio.toFixed(1)}x, ROI slightly boosted)`);
    } else {
      rationaleParts.push(`Duration ${actualMin}m is in line with ${expectedMin}m estimate`);
    }
  }

  // 2. Keyword heuristic on completionNote
  let keywordBonus = 0;
  if (task.completionNote) {
    let posCount = 0;
    let negCount = 0;
    for (const rx of POSITIVE_PATTERNS) if (rx.test(task.completionNote)) posCount++;
    for (const rx of NEGATIVE_PATTERNS) if (rx.test(task.completionNote)) negCount++;

    if (posCount > negCount) {
      keywordBonus = 10;
      rationaleParts.push(`Completion note contains positive feedback`);
    } else if (negCount > posCount) {
      keywordBonus = -15;
      rationaleParts.push(`Completion note indicates difficulties or blockers`);
    }
  }
  proposedScore = Math.min(100, Math.max(1, proposedScore + keywordBonus));

  // 3. Proof attachment heuristic
  if (task.proof) {
    const proofObj = task.proof as Record<string, any>;
    if (proofObj.urls?.length || proofObj.screenshots?.length || proofObj.metrics) {
      proposedScore = Math.min(100, proposedScore + 5);
      rationaleParts.push(`Rich proof attached (+5 ROI)`);
    }
  }

  // 4. Additive modifiers (Goal alignment, long horizon delayed payoff, business domain)
  let additiveModifiers = 0;
  if (task.goalId) {
    additiveModifiers += 10;
    rationaleParts.push("Goal alignment (+10 ROI)");
    try {
      const goal = await prisma.lifeGoal.findUnique({
        where: { id: task.goalId },
        select: { horizon: true },
      });
      if (goal?.horizon && ["QUARTER", "YEAR", "LIFE"].includes(goal.horizon)) {
        additiveModifiers += 5;
        rationaleParts.push(`Long-term horizon ${goal.horizon} delayed payoff leverage (+5 ROI)`);
      }
    } catch (err) {
      log.warn("failed_to_fetch_goal_horizon", { taskId: task.id, err: String(err) });
    }
  }

  try {
    let isBusiness = false;
    if ((task as any).mission?.domain) {
      const domain = (task as any).mission.domain;
      isBusiness = domain === "BUSINESS" || domain === "FINANCE";
    } else if (task.missionId) {
      const mission = await prisma.mission.findUnique({
        where: { id: task.missionId },
        select: { domain: true },
      });
      if (mission) {
        isBusiness = mission.domain === "BUSINESS" || mission.domain === "FINANCE";
      }
    }
    if (isBusiness) {
      additiveModifiers += 10;
      rationaleParts.push("Business/Finance domain leverage (+10 ROI)");
    }
  } catch (err) {
    log.warn("failed_to_fetch_mission_domain", { taskId: task.id, err: String(err) });
  }

  proposedScore = Math.min(100, Math.max(1, proposedScore + additiveModifiers));

  const finalScore = Math.round(proposedScore);
  const diff = finalScore - baseRoi;

  let classification: ProposedTaskOutcome["classification"] = "accurate";
  if (diff > 10) {
    classification = "underestimated";
  } else if (diff < -10) {
    classification = "overestimated";
  }

  if (actualMin === 0 && !task.completionNote && !task.proof) {
    classification = "insufficient_evidence";
    rationaleParts.push("No execution time, completion note, or proof provided to judge ROI");
  }

  return {
    outcomeScore: finalScore,
    classification,
    rationale: rationaleParts.join(". ") || "Calculated baseline matches estimate.",
  };
}

interface ProposedPredictionOutcome {
  status: "confirmed" | "disproven" | "expired" | "needs_more_evidence";
  outcomeDescription: string;
  evidence: Record<string, any>;
}

/**
 * Propose prediction outcome based on memory searches and business metrics.
 */
export async function proposePredictionOutcome(pred: Prediction): Promise<ProposedPredictionOutcome> {
  const evidence: Record<string, any> = {
    dataFreshness: new Date().toISOString(),
    proxyStatus: "proxy",
  };
  const targetDateIso = pred.targetDate ? new Date(`${pred.targetDate}T00:00:00Z`).toISOString() : pred.createdAt.toISOString();

  // 1. Query business metrics if it's a business/operational prediction mentioning revenue or GSC
  const textLower = pred.prediction.toLowerCase();
  const isBusiness = pred.category === "business" || pred.category === "operational" || textLower.includes("revenue") || textLower.includes("leads") || textLower.includes("gsc");
  
  if (isBusiness) {
    evidence.source = "nickstire_bridge";
    try {
      // Impose a strict 5s timeout on bridge queries as requested
      const businessRes = await queryNick<{ totalDollars?: number; invoiceCount?: number }>(
        "revenue_range",
        { from: pred.targetDate, to: pred.targetDate },
        5000
      );

      if (businessRes && !("error" in businessRes) && businessRes.data) {
        evidence.businessMetrics = businessRes.data;
        evidence.proxyStatus = textLower.includes("revenue") ? "direct" : "proxy";
        log.info("business_evidence_found", { predictionId: pred.id, data: businessRes.data });

        // Simple numeric threshold checker
        const numMatch = textLower.match(/\$?([0-9]{3,7})/);
        if (numMatch && businessRes.data.totalDollars !== undefined) {
          const targetNum = parseInt(numMatch[1], 10);
          const actualDollars = businessRes.data.totalDollars;
          
          if (pred.kind === "continuous" || pred.kind === "numeric") {
            const error = Math.abs(actualDollars - targetNum) / (targetNum || 1);
            const accuracyScore = Math.max(0, 100 - Math.round(error * 100));
            return {
              status: error <= 0.1 ? "confirmed" : "disproven",
              outcomeDescription: `Auto-graded continuous prediction: target $${targetNum} vs actual $${actualDollars.toFixed(2)} (${accuracyScore}% accuracy).`,
              evidence,
            };
          }

          const exceeds = textLower.includes("exceed") || textLower.includes("above") || textLower.includes(">") || textLower.includes("more than");
          const below = textLower.includes("below") || textLower.includes("less than") || textLower.includes("<") || textLower.includes("under");

          if (exceeds && actualDollars > targetNum) {
            return {
              status: "confirmed",
              outcomeDescription: `Auto-graded confirmed: target revenue $${targetNum} exceeded with actual $${actualDollars.toFixed(2)}.`,
              evidence,
            };
          } else if (exceeds && actualDollars <= targetNum) {
            return {
              status: "disproven",
              outcomeDescription: `Auto-graded disproven: target revenue $${targetNum} not met (actual $${actualDollars.toFixed(2)}).`,
              evidence,
            };
          } else if (below && actualDollars < targetNum) {
            return {
              status: "confirmed",
              outcomeDescription: `Auto-graded confirmed: revenue remained below $${targetNum} (actual $${actualDollars.toFixed(2)}).`,
              evidence,
            };
          } else if (below && actualDollars >= targetNum) {
            return {
              status: "disproven",
              outcomeDescription: `Auto-graded disproven: revenue did not remain below $${targetNum} (actual $${actualDollars.toFixed(2)}).`,
              evidence,
            };
          }
        }
      } else if (businessRes && "error" in businessRes) {
        evidence.failureState = String((businessRes as any).error || "Unknown bridge error");
      }
    } catch (err) {
      log.warn("business_bridge_failed", { predictionId: pred.id, err: String(err) });
      evidence.failureState = err instanceof Error ? err.message : String(err);
    }
  }

  // 2. Fall back to / combine with semantic memory check
  evidence.source = isBusiness && evidence.source ? evidence.source : "brain_memories";
  try {
    const queryText = `${pred.prediction} ${pred.basis || ""}`;
    const emb = await getEmbedding(queryText).catch(() => [] as number[]);
    if (emb.length > 0) {
      const padded = padToTargetDim(emb);
      const vecLit = `[${padded.join(",")}]`;

      const memories = await prisma.$queryRawUnsafe<
        Array<{ content: string; distance: number }>
      >(
        `SELECT bm.content::text AS content,
                (ve.embedding_vec_1536 <=> '${vecLit}'::vector(${TARGET_DIM})) AS distance
         FROM vector_embeddings ve
         JOIN brain_memories bm
           ON bm.id = ve."sourceId"
          AND bm.deleted_at IS NULL
         WHERE ve."sourceType" = 'brain_memory'
           AND ve.embedding_vec_1536 IS NOT NULL
           AND bm.created_at >= '${targetDateIso}'
         ORDER BY ve.embedding_vec_1536 <=> '${vecLit}'::vector(${TARGET_DIM})
         LIMIT ${KNN_TOP}`
      ).catch(() => []);

      const strongMemories = memories.filter(m => 1 - m.distance >= SIM_THRESHOLD_HIGH);
      if (strongMemories.length > 0) {
        evidence.matchingMemories = strongMemories.map(m => ({
          content: m.content,
          similarity: 1 - m.distance,
        }));

        let posHits = 0;
        let negHits = 0;
        for (const m of strongMemories) {
          for (const rx of POSITIVE_PATTERNS) if (rx.test(m.content)) posHits++;
          for (const rx of NEGATIVE_PATTERNS) if (rx.test(m.content)) negHits++;
        }

        if (posHits >= 2 && negHits === 0) {
          return {
            status: "confirmed",
            outcomeDescription: `Auto-graded confirmed based on semantic memory evidence: "${strongMemories[0].content.slice(0, 150)}..."`,
            evidence,
          };
        } else if (negHits >= 2 && posHits === 0) {
          return {
            status: "disproven",
            outcomeDescription: `Auto-graded disproven based on semantic memory evidence: "${strongMemories[0].content.slice(0, 150)}..."`,
            evidence,
          };
        }
      }
    }
  } catch (err) {
    log.warn("semantic_match_failed", { predictionId: pred.id, err: String(err) });
  }

  // 3. Needs more evidence
  return {
    status: "needs_more_evidence",
    outcomeDescription: "Unable to determine outcome cleanly from available business metrics or semantic memory records.",
    evidence,
  };
}

export interface ScoreboardStats {
  predictionCount30d: number;
  rollingBrier30d: number | null;
  predictionAccuracyPct: number | null;
  taskRoiCount30d: number;
  taskRoiMae30d: number | null;
  taskRoiBias30d: number | null;
  taskOverestimateRate30d: number;
  calibrationVerdict: "well-calibrated" | "moderate" | "drift" | "unknown";
  biasVerdict: "calibrated" | "overconfident" | "underconfident";
  colorHsl: string;
}

/**
 * Calculate Scoreboard Stats for approved/resolved items in the last 30 days.
 */
export async function calculateScoreboardStats(): Promise<ScoreboardStats> {
  const since = new Date(Date.now() - 30 * 86400_000);

  const resolvedItems = await prisma.calibrationReviewItem.findMany({
    where: {
      status: { in: ["approved", "corrected"] },
      updatedAt: { gte: since },
    },
  });

  const predictionItems = resolvedItems.filter(item => item.type === "prediction");
  const taskRoiItems = resolvedItems.filter(item => item.type === "task_roi");

  // A. Predictions Calculations (Brier Score)
  let rollingBrier30d: number | null = null;
  let predictionAccuracyPct: number | null = null;
  if (predictionItems.length > 0) {
    const briers = predictionItems
      .map(item => item.accuracyScore)
      .filter((b): b is number => b !== null);
    
    if (briers.length > 0) {
      rollingBrier30d = briers.reduce((a, b) => a + b, 0) / briers.length;
      // Map Brier score to accuracy: 0.0 brier -> 100%, 0.25 (naive guess) -> 50%, 1.0 -> 0%
      predictionAccuracyPct = Math.max(0, Math.min(100, Math.round((1 - Math.sqrt(rollingBrier30d)) * 100)));
    }
  }

  // B. Task ROI Calculations (MAE & Bias)
  let taskRoiMae30d: number | null = null;
  let taskRoiBias30d: number | null = null;
  let overestimates = 0;
  if (taskRoiItems.length > 0) {
    let absErrorSum = 0;
    let biasSum = 0;
    let validCount = 0;

    for (const item of taskRoiItems) {
      const pred = item.predictedOutcome as { roiScore?: number };
      const actual = item.approvedActualOutcome as { outcomeScore?: number };

      if (pred?.roiScore !== undefined && actual?.outcomeScore !== undefined) {
        validCount++;
        const error = actual.outcomeScore - pred.roiScore; // negative = overestimate, positive = underestimate
        absErrorSum += Math.abs(error);
        biasSum += error;

        if (pred.roiScore > actual.outcomeScore) {
          overestimates++;
        }
      }
    }

    if (validCount > 0) {
      taskRoiMae30d = absErrorSum / validCount;
      taskRoiBias30d = biasSum / validCount; // negative value means overestimate
    }
  }

  const taskOverestimateRate30d = taskRoiItems.length > 0 
    ? Math.round((overestimates / taskRoiItems.length) * 100) 
    : 0;

  // C. Verdicts & Visual Warning HSL
  let calibrationVerdict: ScoreboardStats["calibrationVerdict"] = "unknown";
  let biasVerdict: ScoreboardStats["biasVerdict"] = "calibrated";
  let colorHsl = "hsl(215, 15%, 50%)"; // slate gray default

  if (predictionItems.length >= 4 && rollingBrier30d !== null) {
    if (rollingBrier30d <= 0.15) {
      calibrationVerdict = "well-calibrated";
      colorHsl = "hsl(142, 76%, 36%)"; // green
    } else if (rollingBrier30d <= 0.25) {
      calibrationVerdict = "moderate";
      colorHsl = "hsl(35, 92%, 47%)"; // amber/orange
    } else {
      calibrationVerdict = "drift";
      colorHsl = "hsl(0, 84%, 60%)"; // red
    }
  }

  if (taskRoiBias30d !== null) {
    if (taskRoiBias30d < -15) {
      biasVerdict = "overconfident"; // Estimated ROI is significantly higher than actual
      if (calibrationVerdict === "unknown") {
        colorHsl = "hsl(0, 84%, 60%)"; // force red alert
      }
    } else if (taskRoiBias30d > 15) {
      biasVerdict = "underconfident"; // Estimated ROI is significantly lower than actual
    }
  }

  return {
    predictionCount30d: predictionItems.length,
    rollingBrier30d,
    predictionAccuracyPct,
    taskRoiCount30d: taskRoiItems.length,
    taskRoiMae30d,
    taskRoiBias30d,
    taskOverestimateRate30d,
    calibrationVerdict,
    biasVerdict,
    colorHsl,
  };
}
