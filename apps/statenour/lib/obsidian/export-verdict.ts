import type { ObsidianEngineStatus } from "./types";

export type ExportVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Decide whether THIS export run succeeded, from the status it published.
 *
 * The status file is shared with the doctor and ingest steps, so its overall
 * `health` can say "error" for reasons that are not this run (a doctor FAIL, or
 * a flag left by an older run). It stays in the file; it does not decide this
 * run. What decides it: the status was published by this run, and this run
 * counted no failed writes (a memory shortfall is counted as a failure).
 */
export function judgeExportRun(status: ObsidianEngineStatus | null, runStartedAtMs: number): ExportVerdict {
  if (!status?.lastExportRunAt) return { ok: false, reason: "export did not publish a completion status" };
  const publishedAt = Date.parse(status.lastExportRunAt);
  if (!Number.isFinite(publishedAt) || publishedAt < runStartedAtMs) {
    return { ok: false, reason: "export did not publish a completion status for this run" };
  }
  const failed = status.stats.failed ?? 0;
  if (failed > 0) {
    return { ok: false, reason: `export completed with ${failed} failed write(s); refusing false success` };
  }
  return { ok: true };
}
