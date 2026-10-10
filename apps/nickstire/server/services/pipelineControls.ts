/**
 * Pipeline controls (2026-10-10): run a cron job now, advance one reel job one
 * step now. The 15-minute pulse was the only server-side trigger; a reel that
 * was ready to assemble waited for it with nothing to press. These helpers
 * decide what may start and refuse by name; the routers wire them to the SAME
 * runners the tick uses (runJobByName, processNextReelJob(jobId),
 * processNextAssemblyJob(jobId), rendered + audio QA), so no gate is skipped.
 *
 * Runners are started, not awaited: generation and assembly take minutes and a
 * tRPC/HTTP request must return. Failures go to onError (logged by the caller).
 */

export interface CronRunNowDeps {
  names: ReadonlyArray<{ name: string }>;
  run: (jobName: string) => Promise<unknown>;
  onError?: (err: Error) => void;
}

export type StartResult<T extends object> = ({ started: true } & T) | ({ started: false; refusal: string } & T);

export function startCronJobNow(jobName: string, deps: CronRunNowDeps): StartResult<{ jobName: string }> {
  if (!deps.names.some((j) => j.name === jobName)) {
    return { started: false, jobName, refusal: `"${jobName}" is not a registered cron job (${deps.names.map((j) => j.name).join(", ")})` };
  }
  void deps.run(jobName).catch((err) => deps.onError?.(err instanceof Error ? err : new Error(String(err))));
  return { started: true, jobName };
}

export type ReelStep = "generate" | "assemble" | "qa";

/** The one step a reel job in this status may take now, or why none. */
export function reelStepFor(status: string): { step: ReelStep } | { step: null; refusal: string } {
  if (status === "queued") return { step: "generate" };
  if (status === "assets_ready") return { step: "assemble" };
  if (status === "assembled") return { step: "qa" };
  if (["generating", "assembling", "repair_rendering", "publishing", "uploading"].includes(status)) {
    return { step: null, refusal: `job is ${status}: that step is already in flight; wait for it or for the stuck-job recovery (12 min)` };
  }
  return { step: null, refusal: `job is ${status}: nothing to advance from here (queued -> generate, assets_ready -> assemble, assembled -> qa)` };
}

export interface ReelStepRunners {
  generate: (jobId: number) => Promise<unknown>;
  assemble: (jobId: number) => Promise<unknown>;
  qa: (jobId: number) => Promise<unknown>;
  onError?: (step: ReelStep, err: Error) => void;
}

export function startReelStepNow(jobId: number, status: string, runners: ReelStepRunners): StartResult<{ jobId: number; step?: ReelStep }> {
  const decided = reelStepFor(status);
  if (!decided.step) return { started: false, jobId, refusal: decided.refusal };
  const step = decided.step;
  void runners[step](jobId).catch((err) => runners.onError?.(step, err instanceof Error ? err : new Error(String(err))));
  return { started: true, jobId, step };
}
