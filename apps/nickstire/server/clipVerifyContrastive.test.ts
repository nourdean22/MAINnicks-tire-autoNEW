/**
 * Clip verify on a contact sheet, contrastive (deep scout 2026-10-17 #5).
 *
 * Still ONE vision call per clip, on a better input: first/mid/last frames tiled
 * into one image, and the judge must PICK which of up to three shuffled beat
 * descriptions (the clip's own beat plus up to two sibling beats of the same
 * brief) the sheet shows, and say whether the subject stays the same across the
 * tiles. A sibling pick or a subject change refuses with the existing
 * ClipMismatchRefusal; a one-beat brief keeps today's score-only check. The judge
 * is injected: no model and no ffmpeg (the one real-ffmpeg case skips without it).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ClipMismatchRefusal,
  clipJudgeRequest,
  contactSheetArgs,
  extractContactSheet,
  pickSiblingBeats,
  verifyClipsBeforeAssembly,
  type ClipToVerify,
  type ClipVerdict,
} from "./services/clipVerify";
import { assemblyFailureOutcome } from "./services/reelPipeline";

const quiet = { log: () => {} };
const on = { enabled: true, min: 0.6 };
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

describe("the judge's input", () => {
  it("contactSheetArgs tiles the first, middle and last frame side by side into one image", () => {
    const args = contactSheetArgs({ beatNumber: 2, path: "/c/b2.mp4", visual: B2, durationSec: 6 }, "/w/sheet.jpg");
    const ss = args.flatMap((a, i) => (a === "-ss" ? [Number(args[i + 1])] : []));
    expect(ss).toHaveLength(3);
    expect(ss[0]).toBeLessThan(0.5);
    expect(ss[1]).toBe(3);
    expect(ss[2]).toBeGreaterThan(5.5);
    expect(ss[2]).toBeLessThan(6);
    expect(args.filter((a) => a === "/c/b2.mp4")).toHaveLength(3);
    expect(args.join(" ")).toContain("hstack=inputs=3");
    expect(args.slice(-4)).toEqual(["-q:v", "3", "-y", "/w/sheet.jpg"]);
  });

  it("the contrastive prompt lists the candidates by index and never says which is planned", () => {
    const req = clipJudgeRequest({ ...beat2, candidates: [B3, B2, B1] }, "AAAA");
    const text = JSON.stringify(req.messages);
    expect(text).toContain(`0: ${B3}`);
    expect(text).toContain(`1: ${B2}`);
    expect(text).toContain(`2: ${B1}`);
    expect(text).not.toMatch(/Planned visual/i);
    expect(req.outputSchema.schema.required).toEqual(["score", "reason", "pick", "subjectChanges"]);
  });

  it("without candidates the request is today's: planned visual named, {score, reason} schema", () => {
    const req = clipJudgeRequest({ beatNumber: 1, path: "/tmp/b1.mp4", visual: B1 }, "AAAA");
    expect(JSON.stringify(req.messages)).toContain(`Planned visual for beat 1: ${B1}`);
    expect(req.outputSchema.schema.required).toEqual(["score", "reason"]);
  });

  const ffmpeg = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"], { shell: process.platform === "win32" }).status === 0;
  const sample = path.join(__dirname, "..", "data", "generated", "clip-30008-1.mp4");
  it.skipIf(!ffmpeg || !fs.existsSync(sample))("REAL ffmpeg: the contact sheet is one image three tiles wide (skips: needs ffmpeg on PATH and the sample clip)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sheet-"));
    try {
      const file = await extractContactSheet({ beatNumber: 1, path: sample, visual: B1, durationSec: 4 }, dir);
      expect(fs.statSync(file).size).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("wiring: assembly hands each clip its sibling beats", () => {
  it("reelAssembly builds siblings with pickSiblingBeats for every clip it verifies", () => {
    const src = fs.readFileSync(path.join(__dirname, "services", "reelAssembly.ts"), "utf8");
    const call = src.indexOf("verifyClipsBeforeAssembly(");
    expect(src.slice(call, call + 600)).toMatch(/siblings: pickSiblingBeats\(/);
  });
});
