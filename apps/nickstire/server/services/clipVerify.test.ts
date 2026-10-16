/**
 * Canary for services/clipVerify.ts (per-clip verification before assembly).
 *
 * The judge is injected, so the POLICY is pinned without ffmpeg or a model:
 * disabled judges nothing, the floor refuses with a typed ClipMismatchRefusal
 * that assemblyFailureOutcome parks `failed` without spending the retry budget,
 * an unavailable critic never refuses, and the config parses its env exactly.
 * The wiring arms read the real source: assembly calls the verifier after the
 * clip bytes are local and before the voiceover is paid for.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { ClipMismatchRefusal, clipVerifyConfig, verifyClipsBeforeAssembly, type ClipToVerify } from "./clipVerify";
import { ReelAssemblyRefusedError } from "./reelContentRefusal";
import { assemblyFailureOutcome } from "./reelPipeline";

const clips: ClipToVerify[] = [
  { beatNumber: 1, path: "/tmp/b1.mp4", visual: "grey sedan on the lift in bay 2", durationSec: 5 },
  { beatNumber: 2, path: "/tmp/b2.mp4", visual: "tech torquing a lug nut", durationSec: 5 },
];
const quiet = { log: () => {} };

describe("clipVerifyConfig", () => {
  it("is OFF unless REEL_CLIP_VERIFY_ENABLED is exactly \"true\"; the floor defaults to 0.6 and only accepts 0..1", () => {
    expect(clipVerifyConfig({})).toEqual({ enabled: false, min: 0.6 });
    expect(clipVerifyConfig({ REEL_CLIP_VERIFY_ENABLED: "1" }).enabled).toBe(false);
    expect(clipVerifyConfig({ REEL_CLIP_VERIFY_ENABLED: "true", REEL_CLIP_VERIFY_MIN: "0.8" })).toEqual({ enabled: true, min: 0.8 });
    expect(clipVerifyConfig({ REEL_CLIP_VERIFY_MIN: "1.7" }).min).toBe(0.6);
    expect(clipVerifyConfig({ REEL_CLIP_VERIFY_MIN: "abc" }).min).toBe(0.6);
  });
});

describe("verifyClipsBeforeAssembly", () => {
  it("disabled: returns [] and never calls the judge (no spend)", async () => {
    const judge = vi.fn();
    expect(await verifyClipsBeforeAssembly(clips, { enabled: false, min: 0.6 }, judge, quiet)).toEqual([]);
    expect(judge).not.toHaveBeenCalled();
  });

  it("enabled: every clip at or above the floor passes with a vision verdict per beat", async () => {
    const judge = vi.fn(async (c: ClipToVerify) => ({ score: c.beatNumber === 1 ? 0.6 : 0.95, reason: "matches" }));
    const v = await verifyClipsBeforeAssembly(clips, { enabled: true, min: 0.6 }, judge, quiet);
    expect(v.map((x) => [x.beatNumber, x.score, x.critic])).toEqual([[1, 0.6, "vision"], [2, 0.95, "vision"]]);
    expect(judge).toHaveBeenCalledTimes(2);
  });

  it("BREAKS: a clip below the floor refuses with ClipMismatchRefusal naming beat, score and reason, and stops judging", async () => {
    const judge = vi.fn(async (c: ClipToVerify) => (c.beatNumber === 1 ? { score: 0.31, reason: "frame shows the storefront, not a sedan on a lift" } : { score: 0.9, reason: "ok" }));
    const err = await verifyClipsBeforeAssembly(clips, { enabled: true, min: 0.6 }, judge, quiet).catch((e) => e);
    expect(err).toBeInstanceOf(ClipMismatchRefusal);
    expect(err).toBeInstanceOf(ReelAssemblyRefusedError);
    expect(err.message).toBe("CLIP_MISMATCH beat 1 scored 0.31 below 0.60: frame shows the storefront, not a sedan on a lift");
    expect(err.verdict.beatNumber).toBe(1);
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it("the refusal is typed for the pipeline: assemblyFailureOutcome parks it failed WITHOUT spending the retry budget", () => {
    const refusal = new ClipMismatchRefusal({ beatNumber: 3, score: 0.1, reason: "r", critic: "vision", evaluatedAt: "t" }, 0.6);
    expect(assemblyFailureOutcome(refusal, 1)).toEqual({ status: "failed", attempts: 0 });
    // control: a plain error on attempt 1 goes back to assets_ready (retry budget spent)
    expect(assemblyFailureOutcome(new Error("ffmpeg exit 1"), 1)).toEqual({ status: "assets_ready", attempts: 1 });
  });

  it("an unavailable critic (throw, or no numeric score) never refuses: recorded as unavailable, assembly continues", async () => {
    const logs: string[] = [];
    const judge = vi.fn(async (c: ClipToVerify) => {
      if (c.beatNumber === 1) throw new Error("timeout after 60000ms");
      return { reason: "prose only" };
    });
    const v = await verifyClipsBeforeAssembly(clips, { enabled: true, min: 0.6 }, judge, { log: (m) => logs.push(m) });
    expect(v.map((x) => [x.beatNumber, x.score, x.critic])).toEqual([[1, null, "unavailable"], [2, null, "unavailable"]]);
    expect(v[0].reason).toMatch(/critic unavailable: timeout/);
    expect(logs).toHaveLength(2);
  });

  it("scores are clamped into 0..1 and reasons capped, so a wild reply cannot produce a >1 match", async () => {
    const judge = async () => ({ score: 7, reason: "x".repeat(900) });
    const v = await verifyClipsBeforeAssembly(clips.slice(0, 1), { enabled: true, min: 0.6 }, judge, quiet);
    expect(v[0].score).toBe(1);
    expect(v[0].reason).toHaveLength(400);
  });
});

describe("wiring: assembleReel verifies after the bytes are local and before the voiceover is paid for", () => {
  const src = fs.readFileSync(path.join(__dirname, "reelAssembly.ts"), "utf8");
  it("calls verifyClipsBeforeAssembly with clipVerifyConfig() between the clip loop and generateVoiceover, and returns clipVerdicts", () => {
    const loopEnd = src.indexOf('log.warn("clip probe failed (assembly continues)"');
    const verify = src.indexOf("verifyClipsBeforeAssembly(");
    const vo = src.indexOf("const vo = await generateVoiceover(");
    expect(loopEnd).toBeGreaterThan(0);
    expect(verify).toBeGreaterThan(loopEnd);
    expect(vo).toBeGreaterThan(verify);
    expect(src).toMatch(/clipVerifyConfig\(\)/);
    expect(src).toMatch(/clipVerdicts \}/);
  });
  it("the pipeline persists the verdicts beside the probes", () => {
    const pipe = fs.readFileSync(path.join(__dirname, "reelPipeline.ts"), "utf8");
    expect(pipe).toMatch(/clipVerdicts \} = await assembleReel\(/);
    expect(pipe).toMatch(/await persistClipVerdicts\(d, job\.id, clipVerdicts\)/);
    expect(pipe).toMatch(/payload\.clipVerify = \{ verdicts, recordedAt/);
  });
  it("a refusal also leaves its verdict on the payload (the consumer of ClipMismatchRefusal in the failure path)", () => {
    const pipe = fs.readFileSync(path.join(__dirname, "reelPipeline.ts"), "utf8");
    const failPath = pipe.indexOf("assemblyFailureOutcome(err, attempt);");
    const persistRefused = pipe.indexOf("if (err instanceof ClipMismatchRefusal) await persistClipVerdicts(d, job.id, [err.verdict]);");
    expect(failPath).toBeGreaterThan(0);
    expect(persistRefused).toBeGreaterThan(failPath);
  });
});
