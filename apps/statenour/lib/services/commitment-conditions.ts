/**
 * BDN-208 · conditions-aware commitment outcomes (2026-08-13).
 *
 * The Army never records a naked completion — every task is graded as
 * Task + CONDITIONS + Standard (FM 7-0 T&EO). This module stamps the
 * conditions that were TRUE when a commitment reached a terminal state
 * (sleep, energy, stress, day-state), so per-condition completion rates
 * become measurable instead of anecdotal ("I break promises when I'm
 * under-slept" becomes a queryable claim).
 *
 * Zero-DDL: one BrainMemory(category: commitment_condition) row per
 * commitment outcome, metadata carrying the structured snapshot.
 * Fire-and-forget from the completion paths — capture failing must
 * NEVER block or fail a completion tap.
 *
 * Deliberately NOT built (operator game-feel HOLD class, gate doc):
 * Red/Amber/Green week gamification and streak re-scoring. This ships
 * the measurement; re-scoring is an operator design decision once the
 * per-condition data exists.
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/commitment-conditions");

export const CONDITION_CATEGORY = "commitment_condition";
const SHORT_SLEEP_HOURS = 6; // matches lib/brain/analyzers/sleep.ts short-night line

export interface ConditionSnapshot {
  commitmentId: number;
  outcome: "completed" | "abandoned" | "broken" | "verified";
  sleepHours: number | null;
  energy: number | null;
  stress: number | null;
  dayState: string | null;
  capturedAt: string;
}

/** Pure classification — exported for tests + the stats read model. */
export function classifyConditions(s: Pick<ConditionSnapshot, "sleepHours" | "energy" | "stress">): string[] {
  const tags: string[] = [];
  if (s.sleepHours !== null) tags.push(s.sleepHours < SHORT_SLEEP_HOURS ? "short_sleep" : "rested");
  if (s.energy !== null) tags.push(s.energy <= 2 ? "low_energy" : "energized");
  if (s.stress !== null && s.stress >= 4) tags.push("high_stress");
  if (tags.length === 0) tags.push("conditions_unknown");
  return tags;
}

/** Pure aggregation — per-condition outcome mix over captured snapshots. */
export function conditionedCompletionStats(
  snapshots: ReadonlyArray<Pick<ConditionSnapshot, "outcome" | "sleepHours" | "energy" | "stress">>,
): Record<string, { completed: number; abandoned: number; broken: number; verified: number; total: number }> {
  const out: Record<string, { completed: number; abandoned: number; broken: number; verified: number; total: number }> = {};
  for (const s of snapshots) {
    for (const tag of classifyConditions(s)) {
      out[tag] ??= { completed: 0, abandoned: 0, broken: 0, verified: 0, total: 0 };
      out[tag][s.outcome] += 1;
      out[tag].total += 1;
    }
  }
  return out;
}

/**
 * Capture the operator's current conditions for a commitment outcome.
 * Best-effort; callers use `void captureCommitmentConditions(...)`.
 */
export async function captureCommitmentConditions(
  commitmentId: number,
  outcome: ConditionSnapshot["outcome"],
): Promise<void> {
  try {
    const [body, dayState] = await Promise.all([
      prisma.bodyTracking.findFirst({
        orderBy: { date: "desc" },
        select: { sleepHours: true, energy: true, stress: true, date: true },
      }),
      prisma.dailyExecutionState
        .findFirst({ orderBy: { stateDate: "desc" }, select: { dayState: true } })
        .catch(() => null),
    ]);
    const snapshot: ConditionSnapshot = {
      commitmentId,
      outcome,
      sleepHours: body?.sleepHours ?? null,
      energy: body?.energy ?? null,
      stress: body?.stress ?? null,
      dayState: dayState?.dayState ?? null,
      capturedAt: new Date().toISOString(),
    };
    const tags = classifyConditions(snapshot);
    await prisma.brainMemory.upsert({
      where: {
        category_key: {
          category: CONDITION_CATEGORY,
          key: `commitment-condition:${commitmentId}`,
        },
      },
      create: {
        category: CONDITION_CATEGORY,
        key: `commitment-condition:${commitmentId}`,
        content: `Commitment ${commitmentId} → ${outcome} under: ${tags.join(", ")}`,
        confidence: 0.9,
        source: "commitment-conditions",
        metadata: { ...snapshot, tags },
      },
      update: {
        content: `Commitment ${commitmentId} → ${outcome} under: ${tags.join(", ")}`,
        lastSeen: new Date(),
        metadata: { ...snapshot, tags },
      },
    });
  } catch (e) {
    // Loud in logs, silent to the operator — a failed capture must never
    // break a completion tap.
    log.warn("condition_capture_failed", {
      commitmentId,
      outcome,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
