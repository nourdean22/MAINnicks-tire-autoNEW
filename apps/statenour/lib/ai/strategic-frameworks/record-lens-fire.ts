/**
 * recordLensFire · v10.0.264 · centralized telemetry for the
 * strategic-frameworks lens-injection sites.
 *
 * Pre-fix · each of 8 AI surfaces had its own copy of
 *   log.info("strategic_lens_injected", { surface, length, count, frameworks, scores, fallback })
 * The pattern was correct but duplicated 8x · adding persistence
 * meant editing 8 files. Centralizing into one helper means:
 *   · One place to change telemetry shape
 *   · One place to add persistence (this version adds SystemMetric writes)
 *   · One place to add sampling / rate-limiting if needed
 *
 * Usage at each surface ·
 *   recordLensFire({ surface: "chat", matches, lensBlockLength });
 *
 * The helper does TWO writes per call ·
 *   1. log.info("strategic_lens_injected", ...) for Vercel runtime logs
 *      (retained for grep-based diagnostics + back-compat with existing
 *      log filters Nour has set up).
 *   2. prisma.systemMetric.create({ metric: "ai.lens_fired", ... }) for
 *      the /admin/lens-stats dashboard. Non-blocking · errors are
 *      caught + dropped so a failing metric write never blocks the
 *      AI response.
 *
 * Surfaces wired (v10.0.264) ·
 *   chat · assist · coach-goal · review · teach · tasks
 *   suggest-goals · nick-noticed
 */

import type { FrameworkMatch } from "./types";
import { logger as rootLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const log = rootLogger.withSurface("ai/strategic-frameworks");

export interface RecordLensFireInput {
  /** The AI surface that fired the lens · used for per-surface aggregations */
  surface: string;
  /** Picker matches · empty array means generic-fallback block was injected */
  matches: FrameworkMatch[];
  /** Length of the injected lens block · 0 means nothing injected */
  lensBlockLength: number;
  /** Optional extra metadata · stored in SystemMetric.tags */
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Single telemetry call that handles both the log line + the
 * persistent metric row. Errors are swallowed silently · we never
 * want telemetry to break the AI response path.
 */
export function recordLensFire(input: RecordLensFireInput): void {
  const { surface, matches, lensBlockLength, metadata } = input;

  const frameworkIds = matches.map((m) => m.framework.id);
  const scores = matches.map((m) => Number(m.score.toFixed(2)));
  const fallback = matches.length === 0;

  // 1. Structured log · same shape as the inline pattern that was there
  //    before so existing log-search filters keep working.
  log.info("strategic_lens_injected", {
    surface,
    length: lensBlockLength,
    count: matches.length,
    frameworks: frameworkIds,
    scores,
    fallback,
    ...(metadata ?? {}),
  });

  // 2. Persistent metric · one row per fired framework so the dashboard
  //    can aggregate per-framework per-surface counts cleanly. When the
  //    generic fallback fires (matches.length === 0), we write a single
  //    row with framework: "(fallback)" so fallback-rate is queryable.
  void persist({
    surface,
    frameworkIds: fallback ? ["(fallback)"] : frameworkIds,
    scores: fallback ? [0] : scores,
    lensBlockLength,
    metadata,
  });
}

interface PersistInput {
  surface: string;
  frameworkIds: string[];
  scores: number[];
  lensBlockLength: number;
  metadata?: Record<string, string | number | boolean | null>;
}

async function persist(input: PersistInput): Promise<void> {
  try {
    // One SystemMetric row per fired framework · lets us count
    // frameworks individually without splitting JSON arrays in SQL.
    await Promise.all(
      input.frameworkIds.map((framework, idx) =>
        prisma.systemMetric.create({
          data: {
            metric: "ai.lens_fired",
            value: input.scores[idx] ?? 0,
            unit: "score",
            source: "lens-injection",
            tags: {
              surface: input.surface,
              framework,
              lensBlockLength: input.lensBlockLength,
              ...(input.metadata ?? {}),
            },
          },
        }),
      ),
    );
  } catch (err) {
    // Telemetry failure must never break the request · just log it.
    log.warn("lens_fire_persist_failed", {
      surface: input.surface,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
