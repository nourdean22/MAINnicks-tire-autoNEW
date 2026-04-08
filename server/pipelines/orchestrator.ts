/**
 * Pipeline Orchestrator — Central coordinator for all data pipelines.
 *
 * Responsibilities:
 * 1. Run all pipelines on schedule with staggered timing
 * 2. Track run history: last run, success/failure, duration
 * 3. Error isolation — one pipeline failure doesn't block others
 * 4. Provide dashboard data: pipeline status, health, last results
 *
 * Pipelines registered:
 * - gbp-reviews: Google Business Profile review analysis
 * - gsc-data: Google Search Console performance data
 * - instagram: Instagram analytics and content scoring
 */

import { pipelineRuns } from "../../drizzle/schema";
import { desc, eq, sql } from "drizzle-orm";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

// ─── TYPES ───────────────────────────────────────────────

export interface PipelineConfig {
  name: string;
  displayName: string;
  /** Minimum interval between runs in milliseconds */
  intervalMs: number;
  /** The async function that runs the pipeline */
  runner: () => Promise<Record<string, unknown>>;
}

export interface PipelineStatus {
  name: string;
  displayName: string;
  lastRun: {
    status: string;
    startedAt: string;
    durationMs: number | null;
    result: Record<string, unknown> | null;
    error: string | null;
  } | null;
  health: "healthy" | "degraded" | "failing" | "never-run";
  nextEligibleRun: string | null;
}

export interface OrchestratorDashboard {
  pipelines: PipelineStatus[];
  overallHealth: "healthy" | "degraded" | "failing";
  lastFullRun: string | null;
  totalRunsToday: number;
}

// ─── PIPELINE REGISTRY ──────────────────────────────────

const PIPELINES: PipelineConfig[] = [
  {
    name: "gbp-reviews",
    displayName: "GBP Reviews",
    intervalMs: 6 * 60 * 60 * 1000, // 6 hours
    runner: async () => {
      const { runReviewPipeline } = await import("./gbp-reviews");
      return runReviewPipeline() as unknown as Record<string, unknown>;
    },
  },
  {
    name: "gsc-data",
    displayName: "GSC Search Data",
    intervalMs: 12 * 60 * 60 * 1000, // 12 hours
    runner: async () => {
      const { runGscPipeline } = await import("./gsc-data");
      return runGscPipeline() as unknown as Record<string, unknown>;
    },
  },
  {
    name: "instagram",
    displayName: "Instagram Analytics",
    intervalMs: 8 * 60 * 60 * 1000, // 8 hours
    runner: async () => {
      const { runInstagramPipeline } = await import("./instagram-data");
      return runInstagramPipeline() as unknown as Record<string, unknown>;
    },
  },
];

// ─── CORE EXECUTION ─────────────────────────────────────

/**
 * Run a single pipeline with full tracking.
 * Records start time, duration, result, and errors.
 */
export async function runPipeline(pipelineName: string): Promise<{
  status: "success" | "error";
  durationMs: number;
  result?: Record<string, unknown>;
  error?: string;
}> {
  const d = await db();
  if (!d) throw new Error("Database not available");

  const config = PIPELINES.find(p => p.name === pipelineName);
  if (!config) throw new Error(`Unknown pipeline: ${pipelineName}`);

  const startTime = Date.now();

  // Record the run as "running"
  const [inserted] = await d.insert(pipelineRuns).values({
    pipelineName,
    status: "running",
    startedAt: new Date(),
  }).$returningId();

  const runId = inserted.id;

  try {
    const result = await config.runner();
    const durationMs = Date.now() - startTime;

    // Update to success
    await d.update(pipelineRuns)
      .set({
        status: "success",
        durationMs,
        resultJson: JSON.stringify(result),
        completedAt: new Date(),
      })
      .where(eq(pipelineRuns.id, runId));

    console.info(`[orchestrator:done] ${config.displayName} completed in ${durationMs}ms`);
    return { status: "success", durationMs, result };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Update to error
    await d.update(pipelineRuns)
      .set({
        status: "error",
        durationMs,
        errorMessage,
        completedAt: new Date(),
      })
      .where(eq(pipelineRuns.id, runId));

    console.error(`[Orchestrator] ${config.displayName} FAILED after ${durationMs}ms:`, errorMessage);
    return { status: "error", durationMs, error: errorMessage };
  }
}

/**
 * Run all pipelines with staggered timing.
 * Each pipeline runs independently — failures are isolated.
 */
export async function runAllPipelines(): Promise<{
  results: Array<{ pipeline: string; status: string; durationMs: number; error?: string }>;
  totalDurationMs: number;
}> {
  const overallStart = Date.now();
  const results: Array<{ pipeline: string; status: string; durationMs: number; error?: string }> = [];

  // Pipelines run sequentially — the serial execution itself provides natural stagger
  for (const config of PIPELINES) {
    try {
      const result = await runPipeline(config.name);
      results.push({
        pipeline: config.name,
        status: result.status,
        durationMs: result.durationMs,
        error: result.error,
      });
    } catch (error) {
      results.push({
        pipeline: config.name,
        status: "error",
        durationMs: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    results,
    totalDurationMs: Date.now() - overallStart,
  };
}

/**
 * Smart run — only runs pipelines that are due based on their interval.
 * Checks last successful run time for each pipeline.
 */
export async function runDuePipelines(): Promise<{
  ran: string[];
  skipped: string[];
  results: Array<{ pipeline: string; status: string; durationMs: number; error?: string }>;
}> {
  const d = await db();
  if (!d) throw new Error("Database not available");

  const ran: string[] = [];
  const skipped: string[] = [];
  const results: Array<{ pipeline: string; status: string; durationMs: number; error?: string }> = [];

  for (const config of PIPELINES) {
    // Check last successful run
    const lastRun = await d
      .select({ startedAt: pipelineRuns.startedAt })
      .from(pipelineRuns)
      .where(eq(pipelineRuns.pipelineName, config.name))
      .orderBy(desc(pipelineRuns.startedAt))
      .limit(1);

    const lastRunTime = lastRun[0]?.startedAt?.getTime() || 0;
    const elapsed = Date.now() - lastRunTime;

    if (elapsed < config.intervalMs) {
      skipped.push(config.name);
      continue;
    }

    try {
      const result = await runPipeline(config.name);
      ran.push(config.name);
      results.push({
        pipeline: config.name,
        status: result.status,
        durationMs: result.durationMs,
        error: result.error,
      });
    } catch (error) {
      ran.push(config.name);
      results.push({
        pipeline: config.name,
        status: "error",
        durationMs: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { ran, skipped, results };
}

// ─── DASHBOARD / STATUS ─────────────────────────────────

/**
 * Get the status of each pipeline for the admin dashboard.
 */
export async function getPipelineStatuses(): Promise<PipelineStatus[]> {
  const d = await db();
  if (!d) return PIPELINES.map(p => ({
    name: p.name,
    displayName: p.displayName,
    lastRun: null,
    health: "never-run" as const,
    nextEligibleRun: null,
  }));

  const statuses: PipelineStatus[] = [];

  for (const config of PIPELINES) {
    // Get last run
    const lastRuns = await d
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.pipelineName, config.name))
      .orderBy(desc(pipelineRuns.startedAt))
      .limit(5);

    const lastRun = lastRuns[0] || null;

    // Determine health based on recent runs
    let health: "healthy" | "degraded" | "failing" | "never-run" = "never-run";
    if (lastRuns.length > 0) {
      const recentSuccesses = lastRuns.filter((r: any) => r.status === "success").length;
      const recentErrors = lastRuns.filter((r: any) => r.status === "error").length;

      if (recentErrors === 0) health = "healthy";
      else if (recentSuccesses > recentErrors) health = "degraded";
      else health = "failing";
    }

    // Calculate next eligible run
    let nextEligibleRun: string | null = null;
    if (lastRun?.startedAt) {
      const nextTime = new Date(lastRun.startedAt.getTime() + config.intervalMs);
      nextEligibleRun = nextTime.toISOString();
    }

    // Parse result JSON safely
    let resultParsed: Record<string, unknown> | null = null;
    if (lastRun?.resultJson) {
      try { resultParsed = JSON.parse(lastRun.resultJson); } catch { /* skip */ }
    }

    statuses.push({
      name: config.name,
      displayName: config.displayName,
      lastRun: lastRun ? {
        status: lastRun.status,
        startedAt: lastRun.startedAt.toISOString(),
        durationMs: lastRun.durationMs,
        result: resultParsed,
        error: lastRun.errorMessage,
      } : null,
      health,
      nextEligibleRun,
    });
  }

  return statuses;
}

/**
 * Get full dashboard data.
 */
export async function getDashboard(): Promise<OrchestratorDashboard> {
  const d = await db();

  const pipelines = await getPipelineStatuses();

  // Overall health
  const healths = pipelines.map(p => p.health);
  let overallHealth: "healthy" | "degraded" | "failing" = "healthy";
  if (healths.includes("failing")) overallHealth = "failing";
  else if (healths.includes("degraded") || healths.includes("never-run")) overallHealth = "degraded";

  // Last full run (most recent run of any pipeline)
  let lastFullRun: string | null = null;
  for (const p of pipelines) {
    if (p.lastRun?.startedAt) {
      if (!lastFullRun || p.lastRun.startedAt > lastFullRun) {
        lastFullRun = p.lastRun.startedAt;
      }
    }
  }

  // Total runs today
  let totalRunsToday = 0;
  if (d) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result = await d
      .select({ count: sql<number>`COUNT(*)` })
      .from(pipelineRuns)
      .where(sql`${pipelineRuns.startedAt} >= ${today}`);
    totalRunsToday = Number(result[0]?.count || 0);
  }

  return {
    pipelines,
    overallHealth,
    lastFullRun,
    totalRunsToday,
  };
}

/**
 * Get run history for a specific pipeline.
 */
export async function getPipelineHistory(pipelineName: string, opts?: { limit?: number }) {
  const d = await db();
  if (!d) return [];

  return d
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.pipelineName, pipelineName))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(opts?.limit ?? 20);
}

/**
 * Get all recent runs across all pipelines.
 */
export async function getRecentRuns(opts?: { limit?: number }) {
  const d = await db();
  if (!d) return [];

  return d
    .select()
    .from(pipelineRuns)
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(opts?.limit ?? 50);
}
