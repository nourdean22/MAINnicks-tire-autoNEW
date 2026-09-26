/**
 * Per-stage timing for the chat pipeline.
 *
 * Wraps each pipeline stage so we get a structured cost breakdown
 * per turn — surfaces in /system/chat-health and persists in
 * AiGeneration.metadata.stages for offline analysis.
 *
 * Usage in a stage handler:
 *   const t = createStageTimer("gate");
 *   ... do work ...
 *   t.end();        // records duration
 *   t.subtask("rate-limit", 12); // optional sub-stage breakdown
 *
 * Usage in the orchestrator:
 *   const tracker = createStageTracker();
 *   const t = tracker.start("prefetch");
 *   ... await prefetch ...
 *   t.end();
 *   ...
 *   const summary = tracker.summary(); // { stages: {prefetch: {ms, subs}}, totalMs }
 */

export interface StageTimer {
  end(): number;
  subtask(name: string, ms: number): void;
}

export interface StageReport {
  ms: number;
  subs?: Record<string, number>;
  cacheHit?: boolean;
  meta?: Record<string, unknown>;
}

export interface StageTracker {
  start(name: string): StageTimer;
  /** Mark a stage's cache-hit status without timing it. */
  cacheHit(name: string, hit: boolean): void;
  /** Attach arbitrary metadata to a stage (e.g. pruned-tool count). */
  meta(name: string, meta: Record<string, unknown>): void;
  summary(): { totalMs: number; stages: Record<string, StageReport> };
}

const PIPELINE_STAGES = [
  "gate",
  "interceptors",
  "classify",
  "prefetch",
  "tool-selector",
  "stream-config",
  "stream-text",
  "post-stream",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export function createStageTracker(): StageTracker {
  const stages: Record<string, StageReport> = {};
  const t0 = performance.now();

  return {
    start(name: string): StageTimer {
      const start = performance.now();
      if (!stages[name]) stages[name] = { ms: 0 };
      return {
        end(): number {
          const ms = Math.round(performance.now() - start);
          stages[name].ms = (stages[name].ms ?? 0) + ms;
          return ms;
        },
        subtask(subName: string, ms: number): void {
          if (!stages[name].subs) stages[name].subs = {};
          stages[name].subs![subName] = ms;
        },
      };
    },
    cacheHit(name: string, hit: boolean): void {
      if (!stages[name]) stages[name] = { ms: 0 };
      stages[name].cacheHit = hit;
    },
    meta(name: string, meta: Record<string, unknown>): void {
      if (!stages[name]) stages[name] = { ms: 0 };
      stages[name].meta = { ...(stages[name].meta ?? {}), ...meta };
    },
    summary(): { totalMs: number; stages: Record<string, StageReport> } {
      return {
        totalMs: Math.round(performance.now() - t0),
        stages,
      };
    },
  };
}

/**
 * Render a stage breakdown into a single-line log string for
 * console output. Helpful when tailing logs in dev or scanning a
 * specific request id.
 *
 * Example output:
 *   [chat-pipeline reqId=abc12 mode=standard] gate=18 prefetch=420(cache) tools=92 stream=1850 finish=180 · total=2560ms
 */
export function formatStageLog(
  reqId: string,
  mode: string,
  summary: ReturnType<StageTracker["summary"]>,
): string {
  const parts: string[] = [];
  for (const [name, rep] of Object.entries(summary.stages)) {
    // A stage marked skipped via meta() never ran; its 0 ms is not a timing.
    if (rep.meta?.skipped) {
      parts.push(`${name}=skipped`);
      continue;
    }
    const cache = rep.cacheHit === true ? "(cache)" : "";
    parts.push(`${name}=${rep.ms}${cache}`);
  }
  return `[chat-pipeline reqId=${reqId} mode=${mode}] ${parts.join(" ")} · total=${summary.totalMs}ms`;
}

export const KNOWN_STAGES: ReadonlyArray<PipelineStage> = PIPELINE_STAGES;

/**
 * Slice 1: Telemetry · Temporal Consistency Checks
 * Identifies tools that completed "too fast" to be physically possible,
 * which may indicate a hallucinated tool execution, a mock that leaked into prod,
 * or an environment decoupled error (where the tool reported success but just instantly returned).
 */
export function checkTemporalConsistency(
  toolName: string,
  durationMs: number,
  args?: Record<string, unknown>
): { consistent: boolean; expectedMinMs: number; reason?: string } {
  // Baseline minimums for physical DB/Network operations
  const baselines: Record<string, number> = {
    createTask: 20, // DB roundtrip
    addTasksToProject: 40, // DB bulk insert
    sendEmail: 150, // Network roundtrip
    sendTelegram: 80, // Network roundtrip
    publishContent: 200, // DB + external
    saveToBrain: 30, // Vector embedding / DB
  };

  let expectedMinMs = baselines[toolName] || 5; // Absolute floor for any tool call is 5ms

  // Adjust complexity based on payload size
  if (toolName === "addTasksToProject" && args?.tasks && Array.isArray(args.tasks)) {
    expectedMinMs += args.tasks.length * 5; // +5ms per task
  }

  const consistent = durationMs >= expectedMinMs;
  return {
    consistent,
    expectedMinMs,
    reason: consistent 
      ? undefined 
      : `Executed in ${durationMs}ms, but expected at least ${expectedMinMs}ms based on physical constraints for ${toolName}.`,
  };
}
