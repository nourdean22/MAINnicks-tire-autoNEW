/**
 * A deterministic content refusal at assembly must not burn the retry budget.
 *
 * Job 2070005, production 2026-10-10: the brief declared `profile` and its
 * caption asked for a send. Enqueue accepted it, five clips were rendered and
 * paid for, and then the ask gate in assembleReel refused the job THREE times
 * inside one cron pulse (ASSEMBLY_PER_PULSE picks the same oldest assets_ready
 * row again after each refusal), each time after downloading the clips and
 * paying for the voiceover. Because the assembly path reads reelJobs.attempts,
 * the third refusal parked the job `failed` with every clip intact.
 *
 * Two properties are pinned, each with a positive control:
 *   1. the ask gate runs BEFORE any download or voiceover, and throws a typed
 *      error (ReelAssemblyRefusedError) rather than a bare Error;
 *   2. the pipeline's failure outcome parks a typed refusal on first contact
 *      and gives the attempt back, while provider failures keep MAX_ATTEMPTS.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_REEL_BRIEFS } from "../client/src/lib/facelessReelStudioSamples";
import { assembleReel, type ReelAssemblyBrief } from "./services/reelAssembly";
import { ReelAssemblyRefusedError } from "./services/reelContentRefusal";
import { assemblyFailureOutcome } from "./services/reelPipeline";

const PROD_CAPTION = "Smooth tires in Cleveland snow are a slide waiting to happen. Send this to someone whose tires look smooth.";

function brief(caption: string): ReelAssemblyBrief {
  const b = structuredClone(SAMPLE_REEL_BRIEFS[0]);
  b.ask = { kind: "profile" };
  b.selectedCaption = caption;
  return b as unknown as ReelAssemblyBrief;
}
const clipsFor = (b: ReelAssemblyBrief) => (b.storyboardBeats ?? []).map((_, i) => `https://clips.invalid/clip-${i}.mp4`);

describe("the ask gate refuses before a byte is downloaded or a voiceover is paid for", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("the production shape is refused with the typed error and fetch is never called", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("network must not be reached"); });
    vi.stubGlobal("fetch", fetchMock);
    const b = brief(PROD_CAPTION);
    await expect(assembleReel(b, clipsFor(b), "t-refused")).rejects.toBeInstanceOf(ReelAssemblyRefusedError);
    await expect(assembleReel(b, clipsFor(b), "t-refused")).rejects.toThrow(/two different asks on two/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("CONTROL: a caption that agrees passes the gate and assembly proceeds to the download", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("network reached (control)"); });
    vi.stubGlobal("fetch", fetchMock);
    const b = brief("Smooth tires in Cleveland snow are a slide waiting to happen.");
    const err = await assembleReel(b, clipsFor(b), "t-control").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ReelAssemblyRefusedError);
    expect((err as Error).message).toMatch(/network reached/);
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("assemblyFailureOutcome: a verdict on the payload is not a failure of the work", () => {
  const refused = new ReelAssemblyRefusedError("refusing to render: two different asks");

  it("a typed refusal parks the job on FIRST contact and gives the attempt back", () => {
    expect(assemblyFailureOutcome(refused, 1)).toEqual({ status: "failed", attempts: 0 });
    expect(assemblyFailureOutcome(refused, 2)).toEqual({ status: "failed", attempts: 1 });
  });

  it("CONTROL: a provider / ffmpeg failure keeps the MAX_ATTEMPTS ladder unchanged", () => {
    const provider = new Error("failed to fetch clip 2 (HTTP 503)");
    expect(assemblyFailureOutcome(provider, 1)).toEqual({ status: "assets_ready", attempts: 1 });
    expect(assemblyFailureOutcome(provider, 2)).toEqual({ status: "assets_ready", attempts: 2 });
    expect(assemblyFailureOutcome(provider, 3)).toEqual({ status: "failed", attempts: 3 });
    expect(assemblyFailureOutcome("not even an Error", 3)).toEqual({ status: "failed", attempts: 3 });
  });

  it("CONTROL: an error that merely SAYS refusing-to-render is still a work failure (type, not text, decides)", () => {
    expect(assemblyFailureOutcome(new Error("refusing to render: two different asks"), 1)).toEqual({ status: "assets_ready", attempts: 1 });
  });
});
