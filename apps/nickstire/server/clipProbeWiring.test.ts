/**
 * Provider drift is measured on clips already paid for (2026-10-08).
 *
 * The measurement lives where the bytes already are: assembly downloads every
 * clip before stitching, probes it there, and the pipeline writes the probes —
 * labelled with each beat's provider — onto the job payload, which the morning
 * brief's lane reader compares week over week (shared/clipDrift.ts). The IO is
 * shelled against real ffmpeg runs elsewhere; this pins the wiring, since a
 * probe nobody persists or nobody reads is a measurement that did not happen.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sliceBlock } from "./testUtils/sourceBlock";

const ASSEMBLY = readFileSync(path.join(__dirname, "services", "reelAssembly.ts"), "utf8");
const PIPELINE = readFileSync(path.join(__dirname, "services", "reelPipeline.ts"), "utf8");
const PAYLOAD = readFileSync(path.join(__dirname, "..", "shared", "reelJobPayload.ts"), "utf8");

describe("clip probes: measured at assembly, persisted by the pipeline, read by lane health", () => {
  it("assembly probes each downloaded clip inside the clip loop and returns the probes", () => {
    const loop = sliceBlock(ASSEMBLY, "const clipProbes: AssembleResult[\"clipProbes\"] = [];", "const { generateVoiceover, generateAssSubtitles }", { label: "assembly clip loop" });
    expect(loop).toContain("clipPaths.push(p);");
    expect(loop.indexOf("await ffprobeReel(p)")).toBeGreaterThan(loop.indexOf("clipPaths.push(p);"));
    expect(loop).toContain("clipProbes.push({ beatNumber: segs[i].beatNumber");
    expect(loop).toContain("clip probe failed (assembly continues)");
    expect(ASSEMBLY).toContain("usedVo: !!voPath, clipProbes };");
  });

  it("the pipeline persists the probes after the assembled write, labelled by the beat's last succeeded providerOp", () => {
    const stage = sliceBlock(PIPELINE, "const { mp4Url, durationSec, clipProbes } = await assembleReel(", 'if (process.env.RENDERED_QA_ENABLED === "true")', { label: "assemble stage" });
    expect(stage.indexOf("await persistClipProbes(d, job.id, clipProbes);")).toBeGreaterThan(stage.indexOf('status: "assembled"'));
    const helper = sliceBlock(PIPELINE, "async function persistClipProbes(", "could not persist clip probes", { label: "persistClipProbes" });
    expect(helper).toContain('find((o) => o.outcome === "succeeded")');
    expect(helper).toContain('return last?.provider ?? "local";');
    expect(helper).toContain("payload.clipProbes = probes.map((p) => ({ ...p, provider: providerOf(p.beatNumber) }));");
  });

  it("the payload view declares the field the writer and the reader share", () => {
    expect(PAYLOAD).toContain("clipProbes?: ClipProbe[];");
  });
});
