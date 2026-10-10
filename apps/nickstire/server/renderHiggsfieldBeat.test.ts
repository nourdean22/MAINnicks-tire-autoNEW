/**
 * ONE per-beat Higgsfield renderer for both the generation lane and the
 * repair lane (2026-10-10 Instagram audit, B1 + B2).
 *
 * The generation stage carried the whole protocol inline — persist the handle
 * on submit, resume a persisted handle instead of resubmitting, record the
 * paid op in history before clearing the handle, keep the handle on a
 * submitted-then-timed-out error — and the repair lane called the provider
 * bare, with none of it. These pins hold the protocol on the shared function
 * so neither caller can drift from it, and cover the CLI lane's new handle.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.doUnmock("./services/higgsfieldStudio");
  vi.resetModules();
});

type Beat = { beatNumber: number; higgsfieldRequestId?: string; higgsfieldRequestLane?: "api" | "cli"; providerOps?: Array<{ provider: string; opId: string; outcome: string }> };

async function load(studio: Record<string, unknown>) {
  vi.doMock("./services/higgsfieldStudio", () => studio);
  vi.resetModules();
  const { HiggsfieldApiSubmittedError } = await import("./services/higgsfieldApiClient");
  const { renderHiggsfieldBeat } = await import("./services/reelPipeline");
  return { HiggsfieldApiSubmittedError, renderHiggsfieldBeat };
}

describe("renderHiggsfieldBeat", () => {
  it("persists the CLI job id AND its lane the moment the submit callback fires, then clears both on success with the op in history", async () => {
    const persisted: Array<Partial<Beat>> = [];
    const gen = vi.fn(async (opts: { onHiggsfieldRequestSubmitted?: (id: string, lane: "api" | "cli") => Promise<void> }) => {
      await opts.onHiggsfieldRequestSubmitted?.("hf_job_1", "cli");
      return "https://cdn/out/clip.mp4";
    });
    const { renderHiggsfieldBeat } = await load({ generateReelClipVideo: gen, pollHiggsfieldCliJob: vi.fn() });
    const beat: Beat = { beatNumber: 2 };

    const url = await renderHiggsfieldBeat({
      beat, prompt: "p", negativePrompt: "n", startImageUrl: "https://cdn/hero.jpg",
      timeoutMs: 120_000, label: "beat 2",
      persist: async () => { persisted.push({ ...beat }); },
    });

    expect(url).toBe("https://cdn/out/clip.mp4");
    expect(persisted[0]).toMatchObject({ higgsfieldRequestId: "hf_job_1", higgsfieldRequestLane: "cli" });
    expect(beat.higgsfieldRequestId).toBeUndefined();
    expect(beat.higgsfieldRequestLane).toBeUndefined();
    expect(beat.providerOps).toEqual([expect.objectContaining({ provider: "higgsfield", opId: "hf_job_1", outcome: "succeeded" })]);
    // the generator saw the start image and a poll deadline inside the worker's
    expect(gen.mock.calls[0][0]).toMatchObject({ prompt: "p", negativePrompt: "n", startImageUrl: "https://cdn/hero.jpg", higgsfieldPollTimeoutMs: 90_000 });
  });

  it("resumes a persisted CLI handle through the read-only poll and never resubmits", async () => {
    const gen = vi.fn();
    const pollCli = vi.fn(async () => "https://cdn/out/resumed.mp4");
    const { renderHiggsfieldBeat } = await load({ generateReelClipVideo: gen, pollHiggsfieldCliJob: pollCli });
    const beat: Beat = { beatNumber: 3, higgsfieldRequestId: "hf_job_9", higgsfieldRequestLane: "cli" };

    const url = await renderHiggsfieldBeat({ beat, prompt: "p", timeoutMs: 120_000, label: "beat 3", persist: async () => {} });

    expect(url).toBe("https://cdn/out/resumed.mp4");
    expect(gen).not.toHaveBeenCalled();
    expect(pollCli).toHaveBeenCalledWith("hf_job_9", expect.objectContaining({ timeoutMs: 90_000 }));
    expect(beat.higgsfieldRequestId).toBeUndefined();
    expect(beat.providerOps).toEqual([expect.objectContaining({ opId: "hf_job_9", outcome: "succeeded" })]);
  });

  it("keeps the handle on a submitted-then-timed-out error, persisted before the error leaves", async () => {
    const persisted: Array<Partial<Beat>> = [];
    const { HiggsfieldApiSubmittedError, renderHiggsfieldBeat } = await load({
      generateReelClipVideo: vi.fn(async () => { throw new HiggsfieldApiSubmittedError("hf_job_2", "Higgsfield CLI generation timed out after 1ms polling job hf_job_2", "cli"); }),
      pollHiggsfieldCliJob: vi.fn(),
    });
    const beat: Beat = { beatNumber: 1 };

    await expect(renderHiggsfieldBeat({ beat, prompt: "p", timeoutMs: 120_000, label: "beat 1", persist: async () => { persisted.push({ ...beat }); } }))
      .rejects.toBeInstanceOf(HiggsfieldApiSubmittedError);

    expect(persisted.at(-1)).toMatchObject({ higgsfieldRequestId: "hf_job_2", higgsfieldRequestLane: "cli" });
    expect(beat.higgsfieldRequestId).toBe("hf_job_2");
  });

  it("a terminal remote failure on resume records the paid op as failed, clears the handle, persists, and rethrows", async () => {
    const persisted: Array<Partial<Beat>> = [];
    const { HiggsfieldApiSubmittedError, renderHiggsfieldBeat } = await load({
      generateReelClipVideo: vi.fn(),
      pollHiggsfieldCliJob: vi.fn(async () => { throw new HiggsfieldApiSubmittedError("hf_job_7", "Higgsfield CLI generation failed for job hf_job_7: status failed", "cli"); }),
    });
    const beat: Beat = { beatNumber: 4, higgsfieldRequestId: "hf_job_7", higgsfieldRequestLane: "cli" };

    await expect(renderHiggsfieldBeat({ beat, prompt: "p", timeoutMs: 120_000, label: "beat 4", persist: async () => { persisted.push({ ...beat }); } }))
      .rejects.toThrow(/generation failed/);

    expect(beat.higgsfieldRequestId).toBeUndefined();
    expect(beat.higgsfieldRequestLane).toBeUndefined();
    expect(beat.providerOps).toEqual([expect.objectContaining({ opId: "hf_job_7", outcome: "failed" })]);
    expect(persisted.at(-1)?.higgsfieldRequestId).toBeUndefined();
  });
});
