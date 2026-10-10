/**
 * The CLI session lane gets a resumable handle (2026-10-10 Instagram audit, B1).
 *
 * `generate create ... --wait` blocked inside one child process with no job
 * id, so a local timeout killed the child while the remote render kept going
 * and billing; the pipeline classified it LOCAL_TIMEOUT_REMOTE_UNKNOWN,
 * terminal on attempt 1: job to needs_regen, ledger failed, slot released,
 * operator paged. On 2026-10-10 both "timed out" beat-5 renders completed on
 * Higgsfield and were paid for. The lane now submits WITHOUT --wait, reads the
 * job id from the created job, and polls `generate get <id> --json` (already
 * allowlisted read-only) — the same shape as the API lane, so a timeout holds
 * a handle and resumes.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildSeedanceArgs, parseCreatedJobId, readCliJobState, pollHiggsfieldCliJob } from "./services/higgsfieldStudio";
import { HiggsfieldApiSubmittedError } from "./services/higgsfieldApiClient";
import { classifyProviderError } from "../shared/providerErrors";
import { isLocalTimeout } from "./services/reelPipeline";

afterEach(() => { vi.unstubAllEnvs(); });

const created = { id: "b8c0a4e2-1b5b-4d2e-9c7f-0d5a1e2f3a4b", job_type: "seedance_2_5", status: "queued", params: { prompt: "x", medias: [{ data: { url: "https://cdn/start.jpg" } }] }, result_url: null };

describe("the create call no longer blocks", () => {
  it("buildSeedanceArgs submits with --json and WITHOUT --wait", () => {
    const args = buildSeedanceArgs("a battery", {});
    expect(args).toContain("--json");
    expect(args).not.toContain("--wait");
  });
});

describe("parseCreatedJobId", () => {
  it("reads the id of the created job", () => {
    expect(parseCreatedJobId(JSON.stringify(created))).toBe(created.id);
  });
  it("accepts the list and wrapper shapes the CLI uses elsewhere", () => {
    expect(parseCreatedJobId(JSON.stringify([created]))).toBe(created.id);
    expect(parseCreatedJobId(JSON.stringify({ job: created }))).toBe(created.id);
    expect(parseCreatedJobId(JSON.stringify({ jobs: [created] }))).toBe(created.id);
  });
  it("refuses output with no id rather than inventing a handle", () => {
    expect(() => parseCreatedJobId(JSON.stringify({ status: "queued" }))).toThrow(/no job id/i);
    expect(() => parseCreatedJobId("not json")).toThrow(/Failed to parse/);
  });
});

describe("readCliJobState", () => {
  it("is RUNNING while result_url is empty, even though the start image URL is already in the JSON", () => {
    // The uploaded start image sits in params.medias; it must never be read as the result.
    expect(readCliJobState(JSON.stringify({ ...created, status: "in_progress" }))).toEqual({ state: "running", status: "in_progress" });
  });
  it("is COMPLETED with the mp4 once result_url is set", () => {
    const done = { ...created, status: "completed", result_url: "https://cdn/out/clip.mp4", min_result_url: "https://cdn/out/clip_min.mp4", thumbnail_url: "https://cdn/out/t.jpg" };
    expect(readCliJobState(JSON.stringify(done))).toEqual({ state: "completed", url: "https://cdn/out/clip.mp4" });
  });
  it("is FAILED on a terminal failure status", () => {
    for (const status of ["failed", "error", "cancelled", "canceled", "rejected", "nsfw"]) {
      expect(readCliJobState(JSON.stringify({ ...created, status }))).toEqual({ state: "failed", status });
    }
  });
  it("reports a 'completed' job whose result is not a video as a terminal failure, never as the clip", () => {
    expect(readCliJobState(JSON.stringify({ ...created, status: "completed", result_url: "https://cdn/out/still.jpg" })))
      .toEqual({ state: "failed", status: "completed_non_video (https://cdn/out/still.jpg)" });
  });
});

describe("pollHiggsfieldCliJob", () => {
  const runSequence = (outs: Array<{ ok: boolean; stdout: string; stderr?: string }>) => {
    const calls: string[][] = [];
    const run = vi.fn(async (args: string[]) => {
      calls.push(args);
      // The last reading repeats for every further poll: a fast runner polls more
      // than once before a 5 ms deadline, and shifting the only entry away
      // produced a TypeError in CI that read as a wrong error class.
      const next = outs.length > 1 ? (outs.shift() as (typeof outs)[number]) : outs[0];
      return { ok: next.ok, stdout: next.stdout, stderr: next.stderr ?? "", code: next.ok ? 0 : 1 };
    });
    return { run, calls };
  };

  it("polls `generate get <id> --json` until the job completes and returns the mp4", async () => {
    const { run, calls } = runSequence([
      { ok: true, stdout: JSON.stringify({ ...created, status: "queued" }) },
      { ok: true, stdout: JSON.stringify({ ...created, status: "in_progress" }) },
      { ok: true, stdout: JSON.stringify({ ...created, status: "completed", result_url: "https://cdn/out/clip.mp4" }) },
    ]);
    await expect(pollHiggsfieldCliJob(created.id, { run, pollIntervalMs: 1, timeoutMs: 5_000 })).resolves.toBe("https://cdn/out/clip.mp4");
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual(["generate", "get", created.id, "--json"]);
  });

  it("a transient read failure is retried, not treated as a lost render", async () => {
    const { run } = runSequence([
      { ok: false, stdout: "", stderr: "502 from api" },
      { ok: true, stdout: "{ not json" },
      { ok: true, stdout: JSON.stringify({ ...created, status: "completed", result_url: "https://cdn/out/clip.mp4" }) },
    ]);
    await expect(pollHiggsfieldCliJob(created.id, { run, pollIntervalMs: 1, timeoutMs: 5_000 })).resolves.toBe("https://cdn/out/clip.mp4");
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("a local timeout throws a SUBMITTED error that carries the job id and names the CLI lane", async () => {
    const { run } = runSequence([{ ok: true, stdout: JSON.stringify({ ...created, status: "in_progress" }) }]);
    const err = await pollHiggsfieldCliJob(created.id, { run, pollIntervalMs: 1, timeoutMs: 5 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HiggsfieldApiSubmittedError);
    expect((err as HiggsfieldApiSubmittedError).requestId).toBe(created.id);
    expect((err as HiggsfieldApiSubmittedError).lane).toBe("cli");
    expect((err as HiggsfieldApiSubmittedError).spendMayHaveOccurred).toBe(true);
    expect((err as Error).message).toMatch(/timed out/i);
    expect((err as Error).message).not.toMatch(/generation (failed|cancelled|canceled)/i); // the pipeline reads that phrase as terminal
  });

  it("the pipeline classifies that timeout as RESUME (no attempt consumed) once the handle is persisted — and as reconcile-first without one", async () => {
    const { run } = runSequence([{ ok: true, stdout: JSON.stringify({ ...created, status: "in_progress" }) }]);
    const err = await pollHiggsfieldCliJob(created.id, { run, pollIntervalMs: 1, timeoutMs: 5 }).catch((e: unknown) => e);
    expect(isLocalTimeout(err)).toBe(true);
    const withHandle = classifyProviderError(err, { isLocalTimeout: isLocalTimeout(err), hasRemoteOperationId: true });
    expect(withHandle.errorClass).toBe("LOCAL_TIMEOUT_REMOTE_RUNNING");
    expect(withHandle.consumesAttempt).toBe(false);
    const withoutHandle = classifyProviderError(err, { isLocalTimeout: isLocalTimeout(err), hasRemoteOperationId: false });
    expect(withoutHandle.errorClass).toBe("LOCAL_TIMEOUT_REMOTE_UNKNOWN");
    // PLANTED CANARY: by message alone the wording must not read as a credit
    // wall or a safety block (both would PAUSE the provider and page the operator)
    const byMessage = classifyProviderError(err, {});
    expect(["QUOTA_OR_CREDIT", "SAFETY_POLICY_PERMANENT", "AUTH_INVALID"]).not.toContain(byMessage.errorClass);
  });

  it("the API lane's own poll timeout carries the same marker", () => {
    const err = new HiggsfieldApiSubmittedError("req_1", "Higgsfield API generation timed out after 1ms polling request req_1", "api", true);
    expect(isLocalTimeout(err)).toBe(true);
    expect(classifyProviderError(err, { isLocalTimeout: true, hasRemoteOperationId: true }).errorClass).toBe("LOCAL_TIMEOUT_REMOTE_RUNNING");
  });

  it("a terminal remote failure throws the phrase the pipeline reads as 'safe to replace', classified REMOTE_FAILED", async () => {
    const { run } = runSequence([{ ok: true, stdout: JSON.stringify({ ...created, status: "failed" }) }]);
    const err = await pollHiggsfieldCliJob(created.id, { run, pollIntervalMs: 1, timeoutMs: 5_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HiggsfieldApiSubmittedError);
    expect((err as Error).message).toMatch(/generation failed/i);
    expect(isLocalTimeout(err)).toBe(false);
    expect(classifyProviderError(err, { isLocalTimeout: false, hasRemoteOperationId: true }).errorClass).toBe("REMOTE_FAILED");
  });
});
