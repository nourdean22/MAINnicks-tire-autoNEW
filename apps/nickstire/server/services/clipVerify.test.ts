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
import { ClipMismatchRefusal, clipVerifyConfig, mergeClipVerdictsIntoPayload, verifyClipsBeforeAssembly, type ClipToVerify } from "./clipVerify";
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
  it("a present-but-blank floor is ABSENT (0.6), never a zero floor that can no longer refuse (Codex P2)", () => {
    expect(clipVerifyConfig({ REEL_CLIP_VERIFY_ENABLED: "true", REEL_CLIP_VERIFY_MIN: "" }).min).toBe(0.6);
    expect(clipVerifyConfig({ REEL_CLIP_VERIFY_MIN: "   " }).min).toBe(0.6);
    expect(clipVerifyConfig({ REEL_CLIP_VERIFY_MIN: "0" }).min).toBe(0);
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

  it("a prior VISION verdict for a beat is reused without a judge call; an unavailable prior is re-judged (retry never re-buys a verdict)", async () => {
    const prior = [
      { beatNumber: 1, score: 0.9, reason: "earlier attempt", critic: "vision" as const, evaluatedAt: "t0" },
      { beatNumber: 2, score: null, reason: "timeout", critic: "unavailable" as const, evaluatedAt: "t0" },
    ];
    const judge = vi.fn(async () => ({ score: 0.8, reason: "fresh" }));
    const v = await verifyClipsBeforeAssembly(clips, { enabled: true, min: 0.6 }, judge, { ...quiet, prior });
    expect(judge).toHaveBeenCalledTimes(1);
    expect(judge.mock.calls[0][0].beatNumber).toBe(2);
    expect(v.map((x) => [x.beatNumber, x.score, x.reason])).toEqual([[1, 0.9, "earlier attempt"], [2, 0.8, "fresh"]]);
    // a reused prior still faces the floor
    await expect(verifyClipsBeforeAssembly(clips.slice(0, 1), { enabled: true, min: 0.95 }, judge, { ...quiet, prior })).rejects.toBeInstanceOf(ClipMismatchRefusal);
  });

  it("onVerdict receives every NEW verdict as soon as it exists, including the refused one BEFORE the throw; a failing persister never blocks", async () => {
    const seen: number[] = [];
    const judge = vi.fn(async (c: ClipToVerify) => (c.beatNumber === 1 ? { score: 0.9, reason: "ok" } : { score: 0.2, reason: "drift" }));
    const onVerdict = vi.fn(async (v: { beatNumber: number }) => {
      seen.push(v.beatNumber);
      if (v.beatNumber === 1) throw new Error("db down");
    });
    const err = await verifyClipsBeforeAssembly(clips, { enabled: true, min: 0.6 }, judge, { ...quiet, onVerdict }).catch((e) => e);
    expect(err).toBeInstanceOf(ClipMismatchRefusal);
    expect(seen).toEqual([1, 2]);
    // a reused prior is not re-persisted
    const onAgain = vi.fn(async () => {});
    await verifyClipsBeforeAssembly(clips.slice(0, 1), { enabled: true, min: 0.6 }, judge, { ...quiet, onVerdict: onAgain, prior: [{ beatNumber: 1, score: 0.9, reason: "p", critic: "vision", evaluatedAt: "t" }] });
    expect(onAgain).not.toHaveBeenCalled();
  });

  it("scores are clamped into 0..1 and reasons capped, so a wild reply cannot produce a >1 match", async () => {
    const judge = async () => ({ score: 7, reason: "x".repeat(900) });
    const v = await verifyClipsBeforeAssembly(clips.slice(0, 1), { enabled: true, min: 0.6 }, judge, quiet);
    expect(v[0].score).toBe(1);
    expect(v[0].reason).toHaveLength(400);
  });
});

describe("persistence: merge-by-beat into payload.clipVerify with a compare-and-swap on the exact payload read (claim-before-act)", () => {
  const v1 = { beatNumber: 1, score: 0.9, reason: "a", critic: "vision" as const, evaluatedAt: "t1" };
  const v2 = { beatNumber: 2, score: 0.3, reason: "b", critic: "vision" as const, evaluatedAt: "t2" };
  function store(initial: string, loseFirst = 0) {
    let payload: string | null = initial;
    let losses = loseFirst;
    const swap = vi.fn(async (expected: string, next: string) => {
      if (losses > 0) {
        losses -= 1;
        // a concurrent writer (rendered QA) landed between our read and our swap
        payload = JSON.stringify({ ...JSON.parse(payload ?? "{}"), renderedQa: { decision: "approve" } });
        return 0;
      }
      if (payload !== expected) return 0;
      payload = next;
      return 1;
    });
    return { read: vi.fn(async () => payload), swap, get: () => payload };
  }

  it("merges by beat, keeps every other payload field, and pins the swap to the payload it read", async () => {
    const s = store(JSON.stringify({ storyboardBeats: [{ beatNumber: 1 }], clipVerify: { verdicts: [{ ...v1, score: 0.1 }], recordedAt: "old" } }));
    expect(await mergeClipVerdictsIntoPayload(s, [v2, v1], new Date("2026-10-16T00:00:00Z"))).toBe(true);
    const out = JSON.parse(s.get()!);
    expect(out.storyboardBeats).toEqual([{ beatNumber: 1 }]);
    expect(out.clipVerify.verdicts).toEqual([v1, v2]);
    expect(out.clipVerify.recordedAt).toBe("2026-10-16T00:00:00.000Z");
    expect(s.swap.mock.calls[0][0]).toBe(s.read.mock.results[0].value instanceof Promise ? await s.read.mock.results[0].value : s.read.mock.results[0].value);
  });

  it("BREAKS: when a concurrent writer lands first, the stale swap loses (0 rows), the payload is re-read and the merge keeps THEIR field", async () => {
    const s = store(JSON.stringify({ a: 1 }), 1);
    expect(await mergeClipVerdictsIntoPayload(s, [v1])).toBe(true);
    expect(s.swap).toHaveBeenCalledTimes(2);
    const out = JSON.parse(s.get()!);
    expect(out.renderedQa).toEqual({ decision: "approve" });
    expect(out.clipVerify.verdicts).toEqual([v1]);
  });

  it("gives up after three lost swaps and reports false; a missing row reports false without a swap", async () => {
    const s = store(JSON.stringify({}), 5);
    expect(await mergeClipVerdictsIntoPayload(s, [v1])).toBe(false);
    expect(s.swap).toHaveBeenCalledTimes(3);
    const gone = { read: vi.fn(async () => null), swap: vi.fn(async () => 1) };
    expect(await mergeClipVerdictsIntoPayload(gone, [v1])).toBe(false);
    expect(gone.swap).not.toHaveBeenCalled();
  });

  it("an unparseable payload is treated as empty, never a crash; no verdicts is a no-op", async () => {
    const s = store("{not json");
    expect(await mergeClipVerdictsIntoPayload(s, [v1])).toBe(true);
    expect(JSON.parse(s.get()!).clipVerify.verdicts).toEqual([v1]);
    const n = store("{}");
    expect(await mergeClipVerdictsIntoPayload(n, [])).toBe(true);
    expect(n.swap).not.toHaveBeenCalled();
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
    // frames land in assembly's own workDir (removed in its finally), priors are reused, verdicts stream out
    expect(src).toMatch(/durationSec \?\? null, workDir \}\)\)/);
    expect(src).toMatch(/prior: brief\.clipVerify\?\.verdicts \?\? null, onVerdict: hooks\?\.onClipVerdict/);
  });
  it("the pipeline persists each verdict as it is produced (onClipVerdict) and the refused one in the failure path, through the CAS helper", () => {
    const pipe = fs.readFileSync(path.join(__dirname, "reelPipeline.ts"), "utf8");
    expect(pipe).toMatch(/onClipVerdict: \(verdict\) => persistClipVerdicts\(d, job\.id, \[verdict\]\)/);
    expect(pipe).toMatch(/import \{ ClipMismatchRefusal, persistClipVerdicts \} from "\.\/clipVerify"/);
    expect(pipe).not.toMatch(/async function persistClipVerdicts\(/);
  });
  it("the reassembly caller parks a clip refusal failed with its verdict persisted, instead of restoring the old master to assembled", () => {
    const re = fs.readFileSync(path.join(__dirname, "reelReassemble.ts"), "utf8");
    const refusal = re.indexOf("if (err instanceof ClipMismatchRefusal) {");
    const restore = re.indexOf("Release the claim so the job is actionable again");
    expect(refusal).toBeGreaterThan(0);
    expect(refusal).toBeLessThan(restore);
    const block = re.slice(refusal, restore);
    expect(block).toMatch(/persistClipVerdicts\(d, jobId, \[err\.verdict\]\)/);
    expect(block).toMatch(/status: "failed"/);
  });
  it("a refusal also leaves its verdict on the payload (the consumer of ClipMismatchRefusal in the failure path)", () => {
    const pipe = fs.readFileSync(path.join(__dirname, "reelPipeline.ts"), "utf8");
    const failPath = pipe.indexOf("assemblyFailureOutcome(err, attempt);");
    const persistRefused = pipe.indexOf("if (err instanceof ClipMismatchRefusal) await persistClipVerdicts(d, job.id, [err.verdict]);");
    expect(failPath).toBeGreaterThan(0);
    expect(persistRefused).toBeGreaterThan(failPath);
  });
});
