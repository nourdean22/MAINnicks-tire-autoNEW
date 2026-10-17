/**
 * Clip verify on a contact sheet, contrastive (deep scout 2026-10-17 #5).
 *
 * Still ONE vision call per clip, on a better input: first/mid/last frames tiled
 * into one image, and the judge must PICK which of up to three shuffled beat
 * descriptions (the clip's own beat plus up to two sibling beats of the same
 * brief) the sheet shows, and say whether the subject stays the same across the
 * tiles. A sibling pick or a subject change refuses with the existing
 * ClipMismatchRefusal; a one-beat brief keeps today's score-only check.
 *
 * FLAG-GATED (review of job 2100002, whose beats 1 and 3 are two macro shots of
 * the same end-link bushing): REEL_CLIP_VERIFY_CONTRAST="true" arms it; off is
 * today's single-frame, planned-visual, {score, reason} request, siblings ignored.
 * The judge is either injected or the real one with ffmpeg (spawn) and the model
 * (invokeLLM) mocked, so the request it builds is asserted, not assumed.
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock, llmMock } = vi.hoisted(() => ({ spawnMock: vi.fn(), llmMock: vi.fn() }));
vi.mock("child_process", async (orig) => ({ ...(await orig<typeof import("child_process")>()), spawn: spawnMock }));
vi.mock("./_core/llm", async (orig) => ({ ...(await orig<Record<string, unknown>>()), invokeLLM: llmMock }));

import { ClipMismatchRefusal, clipVerifyConfig, pickSiblingBeats, verifyClipsBeforeAssembly, type ClipToVerify, type ClipVerdict } from "./services/clipVerify";
import { assemblyFailureOutcome } from "./services/reelPipeline";

const quiet = { log: () => {} };
const on = { enabled: true, min: 0.6, contrast: true };
const off = { enabled: true, min: 0.6, contrast: false };
const B1 = "grey sedan on the lift in bay 2";
const B2 = "tech torquing a lug nut on the front wheel";
const B3 = "customer handed keys at the counter";
const beat2: ClipToVerify = {
  beatNumber: 2,
  path: "/tmp/b2.mp4",
  visual: B2,
  durationSec: 5,
  siblings: [{ beatNumber: 1, visual: B1 }, { beatNumber: 3, visual: B3 }],
};
/** A judge that picks the candidate whose text equals `want`, wherever the shuffle put it. */
const picks = (want: string, extra: Record<string, unknown> = {}) =>
  vi.fn(async (c: ClipToVerify & { candidates?: string[] }) => ({ score: 0.9, reason: "looks right", pick: c.candidates!.indexOf(want), subjectChanges: false, ...extra }));
/** Deterministic rng: cycles through the given values. */
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

describe("contrastive verdicts", () => {
  it("a wrong-beat pick refuses with ClipMismatchRefusal naming the beat it shows; the verdict records the pick", async () => {
    const err = await verifyClipsBeforeAssembly([beat2], on, picks(B3), { ...quiet, rng: seq(0.1, 0.7) }).catch((e) => e);
    expect(err).toBeInstanceOf(ClipMismatchRefusal);
    expect(err.verdict.pick).toBe(3);
    expect(err.verdict.subjectChanges).toBe(false);
    expect(err.message).toMatch(/^CLIP_MISMATCH beat 2 shows beat 3's visual/);
    // Same typed refusal, so the same parking: failed, no retry budget spent.
    expect(assemblyFailureOutcome(err, 1)).toEqual({ status: "failed", attempts: 0 });
  });

  it("a subject change across the three tiles refuses even with the right pick and a high score", async () => {
    const err = await verifyClipsBeforeAssembly([beat2], on, picks(B2, { subjectChanges: true }), { ...quiet, rng: seq(0.5) }).catch((e) => e);
    expect(err).toBeInstanceOf(ClipMismatchRefusal);
    expect(err.verdict.pick).toBe(2);
    expect(err.verdict.subjectChanges).toBe(true);
    expect(err.message).toMatch(/^CLIP_MISMATCH beat 2 subject changes across first\/mid\/last/);
  });

  it("the right pick, a steady subject and a score at the floor passes, recording pick and subjectChanges", async () => {
    const v = await verifyClipsBeforeAssembly([beat2], on, picks(B2, { score: 0.6 }), { ...quiet, rng: seq(0.3) });
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ beatNumber: 2, score: 0.6, critic: "vision", pick: 2, subjectChanges: false });
  });

  it("the right pick below the floor still refuses with today's message", async () => {
    const err = await verifyClipsBeforeAssembly([beat2], on, picks(B2, { score: 0.4, reason: "too dark" }), { ...quiet, rng: seq(0.3) }).catch((e) => e);
    expect(err).toBeInstanceOf(ClipMismatchRefusal);
    expect(err.message).toBe("CLIP_MISMATCH beat 2 scored 0.40 below 0.60: too dark");
  });

  it("candidates are shuffled, yet the pick always maps back to the right beat", async () => {
    const seen = new Set<number>();
    for (const r of [seq(0), seq(0.99), seq(0.5, 0.1), seq(0.2, 0.9), seq(0.7, 0.3)]) {
      const judge = picks(B2);
      const v = await verifyClipsBeforeAssembly([beat2], on, judge, { ...quiet, rng: r });
      const asked = judge.mock.calls[0][0] as ClipToVerify & { candidates: string[] };
      expect([...asked.candidates].sort()).toEqual([B1, B2, B3].sort());
      seen.add(asked.candidates.indexOf(B2));
      expect(v[0].pick).toBe(2);
    }
    expect(seen.size).toBeGreaterThan(1); // the right beat does not always sit at index 0
  });

  it("a contrastive reply without a valid pick or subjectChanges falls back to score-only for that field, never weaker than before", async () => {
    for (const reply of [{ reason: "x", subjectChanges: false }, { reason: "x", pick: 7, subjectChanges: false }, { reason: "x", pick: 1.5 }, { reason: "x", pick: "0", subjectChanges: "no" }]) {
      const v = await verifyClipsBeforeAssembly([beat2], on, async () => ({ ...reply, score: 0.9 }), { ...quiet, rng: seq(0.3) });
      expect(v[0].critic).toBe("vision");
      expect(v[0].pick).toBeUndefined();
      // the score still gates: the same malformed reply at 0.2 refuses, as the pre-contrastive check did
      const err = await verifyClipsBeforeAssembly([beat2], on, async () => ({ ...reply, score: 0.2 }), { ...quiet, rng: seq(0.3) }).catch((e) => e);
      expect(err).toBeInstanceOf(ClipMismatchRefusal);
    }
  });
});

describe("one-beat brief: today's score-only check", () => {
  const solo: ClipToVerify = { beatNumber: 1, path: "/tmp/b1.mp4", visual: B1, durationSec: 5 };
  it("no siblings: the judge gets no candidates and a {score, reason} reply decides alone", async () => {
    const judge = vi.fn(async () => ({ score: 0.7, reason: "ok" }));
    const v = await verifyClipsBeforeAssembly([solo], on, judge, quiet);
    expect((judge.mock.calls[0] as unknown[])[0]).not.toHaveProperty("candidates");
    expect(v[0]).toMatchObject({ score: 0.7, critic: "vision" });
    expect(v[0].pick).toBeUndefined();
    const err = await verifyClipsBeforeAssembly([solo], on, async () => ({ score: 0.3, reason: "storefront" }), quiet).catch((e) => e);
    expect(err.message).toBe("CLIP_MISMATCH beat 1 scored 0.30 below 0.60: storefront");
  });

  it("a prior verdict from before this change (no pick, no subjectChanges) is reused and judged score-only", async () => {
    const prior: ClipVerdict[] = [{ beatNumber: 2, score: 0.8, reason: "old", critic: "vision", evaluatedAt: "2026-10-16T00:00:00.000Z" }];
    const judge = vi.fn();
    const v = await verifyClipsBeforeAssembly([beat2], on, judge, { ...quiet, prior });
    expect(judge).not.toHaveBeenCalled();
    expect(v[0].score).toBe(0.8);
  });
});

describe("pickSiblingBeats", () => {
  const beats = [
    { beatNumber: 1, visual: B1 },
    { beatNumber: 2, visual: B2 },
    { beatNumber: 3, visual: B3 },
    { beatNumber: 4, visual: "" },
    { beatNumber: 5, visual: B3 },
  ];
  it("takes the nearest neighbours with a real, different visual, at most two", () => {
    expect(pickSiblingBeats(beats, 2)).toEqual([{ beatNumber: 1, visual: B1 }, { beatNumber: 3, visual: B3 }]);
    expect(pickSiblingBeats(beats, 1)).toEqual([{ beatNumber: 2, visual: B2 }, { beatNumber: 3, visual: B3 }]);
    // beat 5: beat 4 is blank and beat 3 says the same thing; beat 2 is the next real alternative
    expect(pickSiblingBeats(beats, 5)).toEqual([{ beatNumber: 2, visual: B2 }, { beatNumber: 1, visual: B1 }]);
    expect(pickSiblingBeats([{ beatNumber: 1, visual: B1 }], 1)).toEqual([]);
  });
});

/** Today's system prompt, verbatim from before the contrastive commit (381dda826^). */
const TODAY_SYSTEM = "You check ONE frame of a generated automotive reel clip against the shot it was supposed to show. Judge only what is visible. Score 1 when the subject and setting in the plan are clearly on screen, 0 when the frame shows a different subject, a different setting, or has morphed into something else. Reply with JSON only.";

describe("the REAL judge (ffmpeg spawn and invokeLLM mocked): what it extracts and what it asks", () => {
  let dir = "";
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cv-"));
    spawnMock.mockReset();
    llmMock.mockReset();
    // A fake ffmpeg: writes a byte to the output path (the last arg) and exits 0.
    spawnMock.mockImplementation((_bin: string, args: string[]) => {
      const c = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: () => {} });
      setImmediate(() => {
        fs.writeFileSync(args[args.length - 1], "jpg");
        c.emit("close", 0);
      });
      return c;
    });
  });
  const reply = (r: Record<string, unknown>) => ({ choices: [{ message: { content: JSON.stringify(r) } }] });
  const withDir = (c: ClipToVerify): ClipToVerify => ({ ...c, workDir: dir });

  it("REEL_CLIP_VERIFY_CONTRAST parses like REEL_CLIP_VERIFY_ENABLED: exactly \"true\" arms it", () => {
    expect(clipVerifyConfig({}).contrast).toBe(false);
    expect(clipVerifyConfig({ REEL_CLIP_VERIFY_CONTRAST: "1" }).contrast).toBe(false);
    expect(clipVerifyConfig({ REEL_CLIP_VERIFY_CONTRAST: "TRUE" }).contrast).toBe(false);
    expect(clipVerifyConfig({ REEL_CLIP_VERIFY_CONTRAST: "true" }).contrast).toBe(true);
  });

  it("FLAG OFF: siblings passed, yet today's request: one midpoint frame, planned visual named, CLIP_VERDICT_SCHEMA", async () => {
    llmMock.mockResolvedValue(reply({ score: 0.9, reason: "ok" }));
    await verifyClipsBeforeAssembly([withDir(beat2)], off, undefined, quiet);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args.slice(0, -1)).toEqual(["-v", "error", "-ss", "2.50", "-i", "/tmp/b2.mp4", "-frames:v", "1", "-q:v", "3", "-y"]);
    const req = llmMock.mock.calls[0][0];
    expect(req.messages[0]).toEqual({ role: "system", content: TODAY_SYSTEM });
    expect(req.messages[1].content[0]).toEqual({ type: "text", text: `Planned visual for beat 2: ${B2}` });
    expect(req.outputSchema).toEqual({
      name: "clip_verdict",
      schema: {
        type: "object",
        properties: {
          score: { type: "number", description: "0..1: how well the frame shows the planned visual (1 = clearly this subject in this setting, 0 = a different subject or setting)" },
          reason: { type: "string", description: "one sentence naming what matched or what drifted" },
        },
        required: ["score", "reason"],
        additionalProperties: false,
      },
    });
    expect(req).toMatchObject({ maxTokens: 2048, reasoningEffort: "low", timeoutMs: 60_000 });
  });

  it("FLAG OFF: a sibling-pick, subject-change reply cannot refuse; only the score decides", async () => {
    llmMock.mockResolvedValue(reply({ score: 0.9, reason: "looks like beat 3", pick: 0, subjectChanges: true }));
    const v = await verifyClipsBeforeAssembly([withDir(beat2)], off, undefined, quiet);
    expect(v[0]).toMatchObject({ critic: "vision", score: 0.9 });
    expect(v[0].pick).toBeUndefined();
    expect(v[0].subjectChanges).toBeUndefined();
    // the same with an injected judge: it is handed no candidates
    const judge = vi.fn(async () => ({ score: 0.9, reason: "x", pick: 0, subjectChanges: true }));
    await expect(verifyClipsBeforeAssembly([beat2], off, judge, quiet)).resolves.toHaveLength(1);
    expect((judge.mock.calls[0] as unknown[])[0]).not.toHaveProperty("candidates");
    // and the score floor still refuses with today's message
    llmMock.mockResolvedValue(reply({ score: 0.3, reason: "storefront", pick: 1, subjectChanges: false }));
    const err = await verifyClipsBeforeAssembly([withDir(beat2)], off, undefined, quiet).catch((e) => e);
    expect(err.message).toBe("CLIP_MISMATCH beat 2 scored 0.30 below 0.60: storefront");
  });

  it("FLAG ON: a first/mid/last contact sheet, candidates by index, the planned one not named, the four-field schema", async () => {
    llmMock.mockImplementation(async (req: { messages: Array<{ content: unknown }> }) => {
      const text = (req.messages[1].content as Array<{ text?: string }>)[0].text!;
      const idx = text.split("\n").slice(1).findIndex((l) => l.endsWith(B2));
      return reply({ score: 0.9, reason: "ok", pick: idx, subjectChanges: false });
    });
    const v = await verifyClipsBeforeAssembly([withDir({ ...beat2, durationSec: 6 })], on, undefined, { ...quiet, rng: seq(0.9, 0.1) });
    expect(v[0]).toMatchObject({ pick: 2, subjectChanges: false, critic: "vision" });
    const args = spawnMock.mock.calls[0][1] as string[];
    const ss = args.flatMap((a, i) => (a === "-ss" ? [Number(args[i + 1])] : []));
    expect(ss).toEqual([0.1, 3, 5.85]);
    expect(args.join(" ")).toContain("hstack=inputs=3");
    const req = llmMock.mock.calls[0][0];
    const text = JSON.stringify(req.messages);
    for (const b of [B1, B2, B3]) expect(text).toMatch(new RegExp(`[0-2]: ${b}`));
    expect(text).not.toMatch(/Planned visual/i);
    expect(req.outputSchema.schema.required).toEqual(["score", "reason", "pick", "subjectChanges"]);
  });
});

describe("wiring: assembly hands each clip its sibling beats", () => {
  it("reelAssembly builds siblings with pickSiblingBeats for every clip it verifies", () => {
    const src = fs.readFileSync(path.join(__dirname, "services", "reelAssembly.ts"), "utf8");
    const call = src.indexOf("verifyClipsBeforeAssembly(");
    expect(src.slice(call, call + 600)).toMatch(/siblings: pickSiblingBeats\(/);
  });
});
