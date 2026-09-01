import { prisma } from "@/lib/prisma";
import { evaluateReadiness, type HealthGovernorDecision } from "./readiness";

export async function getHealthGovernorContext(): Promise<string> {
  const decision = await getLatestGovernorDecision();
  if (!decision) return "";
  return decision.promptGuardrailText;
}

/** Readiness reads older than this are refused — a 6-week-old health log
 *  must never render as a confident "96/100" (Execution Deck P0, 2026-09-01). */
const READINESS_MAX_AGE_MS = 2 * 86_400_000;

export async function getLatestGovernorDecision(): Promise<HealthGovernorDecision | null> {
  try {
    const latestLog = await prisma.personalDailyLog.findFirst({
      orderBy: { logDate: "desc" },
    });

    // Freshness bound: no recent log → no reading. Null renders as
    // absent/unknown downstream — never as a stale score.
    if (!latestLog || Date.now() - new Date(latestLog.logDate).getTime() > READINESS_MAX_AGE_MS) {
      return null;
    }

    const latestState = await prisma.stateLog.findFirst({
      orderBy: { createdAt: "desc" },
    });

    let healthSummary: any = {};
    if (latestLog?.notes) {
      try {
        if (latestLog.notes.trim().startsWith("{")) {
          const parsed = JSON.parse(latestLog.notes);
          healthSummary = parsed.healthSummary ?? {};
        }
      } catch (e) {
        // fallback to empty summary
      }
    }

    const sleep = latestLog?.sleepHours ? latestLog.sleepHours.toNumber() : null;
    // Fallback order for energy: PersonalDailyLog energyScore -> StateLog energyLevel -> default null
    const energy = latestLog?.energyScore ?? latestState?.energyLevel ?? null;
    const focus = latestState?.focusQuality ?? null;
    const drift = latestState?.driftLevel ?? null;
    const soreness = typeof healthSummary.sorenessScore === "number" ? healthSummary.sorenessScore : null;
    const injury = typeof healthSummary.injuryFlag === "boolean" ? healthSummary.injuryFlag : null;
    const workout = latestLog?.workoutCompleted ?? null;

    const decision = evaluateReadiness({
      sleepHours: sleep,
      energyLevel: energy,
      focusQuality: focus,
      driftLevel: drift,
      sorenessScore: soreness,
      injuryFlag: injury,
      workoutCompletedToday: workout,
    });

    return decision;
  } catch (err) {
    console.error("Failed to evaluate health governor readiness", err);
    return null;
  }
}
