/**
 * GET /api/cron/brain-intelligence
 *
 * Runs the v7.0 self-improving intelligence engines:
 * 1. Score pending predictions (outcome tracking)
 * 2. Find counter-intuitive patterns
 * 3. Distill wisdom from recurring patterns
 * 4. Generate learning journal entry
 * 5. Detect blind spots (stored for system prompt)
 *
 * Runs as part of the evening mega cron.
 */

import { cronHandler } from "@/lib/utils/http";
import { scorePendingPredictions } from "@/lib/brain/outcome-tracker";
import { findCounterIntuitive } from "@/lib/brain/counter-intuitive";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/brain-intelligence");
import { distillWisdom } from "@/lib/brain/wisdom-distiller";
import { generateLearningJournal } from "@/lib/brain/learning-journal";
import { detectBlindSpots } from "@/lib/brain/blind-spot-detector";
import { findCorrelations } from "@/lib/brain/correlation-finder";
import { findTeachingMoments } from "@/lib/brain/teaching-moments";
import { brainMemory } from "@/lib/brain/memory-manager";
export const maxDuration = 120; // Pro plan

export const GET = cronHandler(async () => {
  const results: Record<string, unknown> = {};

  // 1. Score predictions
  try {
    const scored = await scorePendingPredictions();
    results.predictions = {
      scored: scored.length,
      confirmed: scored.filter((s) => s.accurate).length,
      disproven: scored.filter((s) => !s.accurate).length,
    };
  } catch (err) {
    results.predictions = { error: err instanceof Error ? err.message : "failed" };
  }

  // 2. Counter-intuitive findings
  try {
    const findings = await findCounterIntuitive();
    results.counterIntuitive = { found: findings.length };
  } catch (err) {
    results.counterIntuitive = { error: err instanceof Error ? err.message : "failed" };
  }

  // 3. Wisdom distillation
  try {
    const wisdom = await distillWisdom();
    results.wisdom = { distilled: wisdom.length, principles: wisdom };
  } catch (err) {
    results.wisdom = { error: err instanceof Error ? err.message : "failed" };
  }

  // 4. Blind spot detection (store top spots as memories for prompt)
  try {
    const spots = await detectBlindSpots();
    // v10.0.34 — count actual persisted writes. Pre-fix the
    // .catch(() => {}) ate every write failure silently, so the
    // cron returned `{ detected: N }` looking healthy even when
    // zero spots had landed. Now: track persisted vs failed and
    // surface both in the cron-run summary.
    let persistedSpots = 0;
    let failedSpots = 0;
    for (const spot of spots.slice(0, 3)) {
      try {
        await brainMemory.remember(
          "blind_spot",
          `blindspot_${spot.domain}_${Date.now()}`,
          `[${spot.severity.toUpperCase()}] ${spot.description}: ${spot.evidence}. Action: ${spot.suggestedAction}`,
          "blind-spot-detector"
        );
        persistedSpots++;
      } catch (err) {
        failedSpots++;
        log.warn("blindspot_write_failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    results.blindSpots = {
      detected: spots.length,
      persisted: persistedSpots,
      failed: failedSpots,
      critical: spots.filter((s) => s.severity === "critical").length,
    };
  } catch (err) {
    results.blindSpots = { error: err instanceof Error ? err.message : "failed" };
  }

  // 5. Learning journal
  try {
    const journal = await generateLearningJournal();
    results.journal = { date: journal.date, selfAssessment: journal.selfAssessment.slice(0, 200) };
  } catch (err) {
    results.journal = { error: err instanceof Error ? err.message : "failed" };
  }

  // 6. Hidden correlations
  try {
    const corrs = await findCorrelations();
    const surprising = corrs.filter((c) => c.surprising);
    results.correlations = { found: corrs.length, surprising: surprising.length };
  } catch (err) {
    results.correlations = { error: err instanceof Error ? err.message : "failed" };
  }

  // 7. Teaching moments
  try {
    const moments = await findTeachingMoments();
    results.teachingMoments = { found: moments.length };
  } catch (err) {
    results.teachingMoments = { error: err instanceof Error ? err.message : "failed" };
  }

  return results;
});
