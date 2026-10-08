/**
 * Rendered creative QA — defect vocabulary, verdict clamping, and REAL frame
 * extraction against a synthesized video (skipped when ffmpeg is absent).
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  RENDERED_DEFECT_CODES,
  clampVerdict,
  extractReelFrames,
  evaluateRenderedReel,
} from "./services/renderedQa";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

afterEach(() => {
  vi.doUnmock("./_core/llm");
  vi.resetModules();
});

describe("defect vocabulary", () => {
  it("every code carries a severity class and a meaning", () => {
    for (const [code, v] of Object.entries(RENDERED_DEFECT_CODES)) {
      expect(["block", "warn"]).toContain(v.severity);
      expect(v.meaning.length).toBeGreaterThan(10);
      expect(code).toMatch(/^[A-Z_]+$/);
    }
  });
});

describe("clampVerdict", () => {
  it("registry severity wins, block findings force repair, unknown codes drop", () => {
    const v = clampVerdict(
      {
        decision: "approve", // the model's optimism is overruled by its own block finding
        findings: [
          { beatNumber: 3, code: "SUBJECT_CONTINUITY", description: "tread changed", preserve: ["camera"], change: ["restore tread"] },
          { beatNumber: 2, code: "TOTALLY_MADE_UP", description: "x", preserve: [], change: [] },
          { beatNumber: null, code: "PALETTE_DRIFT", description: "warm cast on final", preserve: [], change: [] },
        ],
      },
      7,
      "vision",
    );
    expect(v.decision).toBe("repair");
    expect(v.findings).toHaveLength(2);
    expect(v.findings[0].severity).toBe("block");
    expect(v.findings[1].severity).toBe("warn");
    expect(v.framesEvaluated).toBe(7);
  });

  it("semantic or mechanical misinformation is always a blocking repair", () => {
    for (const code of ["BEAT_SEMANTIC_MISMATCH", "MECHANICAL_MISREPRESENTATION"] as const) {
      const verdict = clampVerdict(
        {
          decision: "approve",
          findings: [{ beatNumber: 2, code, description: "visible teaching mismatch", preserve: [], change: ["regenerate the beat truthfully"] }],
        },
        5,
        "vision",
      );
      expect(verdict.decision).toBe("repair");
      expect(verdict.findings[0].severity).toBe("block");
    }
  });

  it("clean output approves; warn-only output may approve", () => {
    expect(clampVerdict({ decision: "approve", findings: [] }, 5, "vision").decision).toBe("approve");
    const warnOnly = clampVerdict(
      { decision: "approve", findings: [{ beatNumber: 1, code: "WEAK_COMPOSITION", description: "small subject", preserve: [], change: [] }] },
      5,
      "vision",
    );
    expect(warnOnly.decision).toBe("approve");
    expect(warnOnly.findings[0].severity).toBe("warn");
  });
});

describe.skipIf(!hasFfmpeg)("frame extraction (real ffmpeg, synthesized video)", () => {
  it("extracts first, per-beat midpoints, and final frames with distinct content", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rqa-test-"));
    const mp4 = path.join(dir, "golden.mp4");
    // 3 one-second solid-color segments (red/green/blue) -> beats at 0-1, 1-2, 2-3
    const mk = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=c=red:s=270x480:d=1:r=30",
      "-f", "lavfi", "-i", "color=c=green:s=270x480:d=1:r=30",
      "-f", "lavfi", "-i", "color=c=blue:s=270x480:d=1:r=30",
      "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1[out]",
      "-map", "[out]", "-pix_fmt", "yuv420p", "-y", mp4,
    ]);
    expect(mk.status).toBe(0);

    const beats = [
      { beatNumber: 1, startSecond: 0, endSecond: 1 },
      { beatNumber: 2, startSecond: 1, endSecond: 2 },
      { beatNumber: 3, startSecond: 2, endSecond: 3 },
    ];
    const frames = await extractReelFrames(mp4, beats, dir);
    expect(frames.map((f) => f.label)).toEqual(["first", "beat1", "beat2", "beat3", "final"]);
    const sizes = await Promise.all(frames.map(async (f) => (await fs.stat(f.path)).size));
    for (const s of sizes) expect(s).toBeGreaterThan(500);
    // beat midpoints hit different solid colors -> different jpeg bytes
    const [b1, b2, b3] = await Promise.all([1, 2, 3].map(async (i) => (await fs.readFile(frames[i].path)).toString("base64")));
    expect(b1).not.toBe(b2);
    expect(b2).not.toBe(b3);
  }, 60_000);

  // 2026-09-08: the container's (newer) ffmpeg mjpeg encoder REFUSES a
  // limited-range yuv420p master — "Non full-range YUV is non-standard" — unless
  // `-strict unofficial`; every extraction died with exit 234, rendered QA read
  // "unavailable", and the publish door held the reel. An older ffmpeg accepts
  // it silently, so a behavioural run cannot reproduce the failure everywhere.
  // Therefore two checks: the behavioural one (limited-range master, explicit
  // tv range, must extract) and a source canary that discriminates on every
  // ffmpeg by asserting the flag is present in BOTH jpeg-writing calls.
  it("extracts frames from an explicitly LIMITED-RANGE master (the shape the container refused)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rqa-tvrange-"));
    const mp4 = path.join(dir, "tvrange.mp4");
    const mk = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=c=red:s=270x480:d=1:r=30",
      "-f", "lavfi", "-i", "color=c=blue:s=270x480:d=1:r=30",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1[out]",
      "-map", "[out]", "-pix_fmt", "yuv420p", "-color_range", "tv", "-y", mp4,
    ]);
    expect(mk.status).toBe(0);
    const beats = [
      { beatNumber: 1, startSecond: 0, endSecond: 1 },
      { beatNumber: 2, startSecond: 1, endSecond: 2 },
    ];
    const frames = await extractReelFrames(mp4, beats, dir);
    expect(frames.map((f) => f.label)).toEqual(["first", "beat1", "beat2", "final"]);
    const sizes = await Promise.all(frames.map(async (f) => (await fs.stat(f.path)).size));
    for (const s of sizes) expect(s).toBeGreaterThan(500);
  }, 60_000);
});

describe.skipIf(!hasFfmpeg)("frame timestamps are clamped to the RENDERED duration", () => {
  // 2026-09-08, job 1890001: the brief declared beats to ~29 s, the master was
  // 22 s, beat 5's midpoint and the final frame fell past the end, ffmpeg wrote
  // nothing, and the critic reported ENOENT → "skipped" → publish door held.
  it("a brief declaring beats past the end still yields every frame, from inside the master", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rqa-clamp-"));
    const mp4 = path.join(dir, "short.mp4");
    const mk = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=270x480:d=3:r=30", "-pix_fmt", "yuv420p", "-y", mp4]);
    expect(mk.status).toBe(0);
    const beats = [
      { beatNumber: 1, startSecond: 0, endSecond: 10 },
      { beatNumber: 2, startSecond: 10, endSecond: 29 }, // midpoint 19.5 s on a 3 s master
    ];
    const frames = await extractReelFrames(mp4, beats, dir);
    expect(frames.map((f) => f.label)).toEqual(["first", "beat1", "beat2", "final"]);
    for (const f of frames) {
      expect(f.timestamp).toBeLessThan(3);
      expect((await fs.stat(f.path)).size).toBeGreaterThan(500);
    }
  }, 60_000);

  it("POSITIVE CONTROL: without clamping, a -ss past the end produces no file (the exact prod failure)", () => {
    const dir = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=1:r=30", "-pix_fmt", "yuv420p", "-y", path.join(os.tmpdir(), "rqa-eof.mp4")]);
    expect(dir.status).toBe(0);
    const out = path.join(os.tmpdir(), "rqa-eof.jpg");
    spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", "25", "-i", path.join(os.tmpdir(), "rqa-eof.mp4"), "-frames:v", "1", "-q:v", "3", "-strict", "unofficial", "-y", out]);
    expect(spawnSync("node", ["-e", `process.exit(require('fs').existsSync(${JSON.stringify(out)}) && require('fs').statSync(${JSON.stringify(out)}).size > 0 ? 1 : 0)`]).status).toBe(0);
  }, 30_000);
});

describe("mjpeg range guard is present in every jpeg-writing ffmpeg call (source canary)", () => {
  const src = readFileSync(path.join(process.cwd(), "server/services/renderedQa.ts"), "utf8");
  // Line-based on purpose: the contact-sheet call carries "[out]" inside its
  // filter string, which defeats any bracket-balanced regex.
  const jpegCalls = (s: string) => s.split("\n").filter((l) => l.includes("runFfmpeg(") && l.includes('"-q:v", "3"'));
  it("both jpeg calls pass -strict unofficial", () => {
    const calls = jpegCalls(src);
    expect(calls.length, "expected the frame-extraction and contact-sheet calls").toBe(2);
    for (const c of calls) expect(c).toMatch(/"-strict", "unofficial"/);
  });
  it("PLANTED CANARY: removing the flag from either call is caught", () => {
    const broken = src.replace('"-strict", "unofficial", "-y", file', '"-y", file');
    expect(broken).not.toBe(src);
    const calls = jpegCalls(broken);
    expect(calls.some((c) => !/"-strict", "unofficial"/.test(c))).toBe(true);
  });
});

describe("evaluateRenderedReel (mocked vision seam)", () => {
  it("feeds image parts + world invariants to the critic and clamps its verdict", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rqa-mock-"));
    const fake = path.join(dir, "f.jpg");
    await fs.writeFile(fake, Buffer.from("fakejpegbytes"));
    const spy = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ decision: "repair", findings: [{ beatNumber: 2, code: "HUMAN_PRESENT", description: "a hand enters frame", preserve: ["lighting"], change: ["regenerate beat 2 without humans"] }] }) } }],
    });
    vi.doMock("./_core/llm", () => ({ invokeLLM: spy }));
    vi.resetModules();
    const { evaluateRenderedReel: evalReel } = await import("./services/renderedQa");

    const verdict = await evalReel({
      frames: [{ label: "beat2", beatNumber: 2, timestamp: 1.5, path: fake }],
      brief: { topic: "battery freeze", objectCharacter: "battery", visualWorld: { lockedInvariants: "VISUAL WORLD (operator-approved reference frame...)" }, storyboardBeats: [{ beatNumber: 2, visual: "battery under frost" }] },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0][0];
    expect(call.messages[0].content).toContain("APPROVED VISUAL WORLD");
    expect(call.messages[0].content).toContain("BEAT_SEMANTIC_MISMATCH");
    expect(call.messages[0].content).toContain("MECHANICAL_MISREPRESENTATION");
    expect(call.messages[0].content).toContain("belts/hoses and the frame shows a spare tire");
    const userParts = call.messages[1].content;
    expect(userParts.some((p: { type: string }) => p.type === "image_url")).toBe(true);
    expect(verdict.decision).toBe("repair");
    expect(verdict.findings[0].code).toBe("HUMAN_PRESENT");
    expect(verdict.critic).toBe("vision");
  });

  // Review of #2865 (2026-10-01): a reply with no complete JSON object parsed as
  // "{}", which clampVerdict reads as approve / qaState completed / craft 100 —
  // and qualityGate passes that. Red on main for every case below but the control.
  it.each([
    ["truncated at the token cap", '{"decision":"repair","findings":[{"beatNumber":1,"code":"MALFORMED_GEOMETRY","description":"warped rot'],
    ["empty (a safety block)", ""],
    ["null content", null],
    ["prose, no JSON", "I cannot evaluate these frames."],
    ["an object with no decision", "{}"],
  ])("an unreadable critic reply (%s) is a SKIPPED verdict, never an approval", async (_label, content) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rqa-unreadable-"));
    const fake = path.join(dir, "f.jpg");
    await fs.writeFile(fake, Buffer.from("fakejpegbytes"));
    vi.doMock("./_core/llm", () => ({ invokeLLM: vi.fn().mockResolvedValue({ choices: [{ message: { content } }] }) }));
    vi.resetModules();
    const { evaluateRenderedReel: evalReel } = await import("./services/renderedQa");
    const verdict = await evalReel({ frames: [{ label: "beat1", beatNumber: 1, timestamp: 1, path: fake }], brief: { topic: "brakes" } });
    expect(verdict.critic).toBe("skipped");
    expect(verdict.qaState).not.toBe("completed");
  });

  it("callVisionCritic itself throws on a reply with no complete object — the specialist lenses rely on that, not on a decision check", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rqa-parser-"));
    const fake = path.join(dir, "f.jpg");
    await fs.writeFile(fake, Buffer.from("fakejpegbytes"));
    vi.doMock("./_core/llm", () => ({ invokeLLM: vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"decision":"repair","findings":[' } }] }) }));
    vi.resetModules();
    const { callVisionCritic } = await import("./services/renderedQa");
    await expect(
      callVisionCritic({ frames: [{ label: "beat1", beatNumber: 1, timestamp: 1, path: fake }], system: "s", user: "u" }),
    ).rejects.toThrow("no complete JSON object");
  });

  it("reads an array-of-parts reply like a string (the wrapper types content as string | parts[])", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rqa-parts-"));
    const fake = path.join(dir, "f.jpg");
    await fs.writeFile(fake, Buffer.from("fakejpegbytes"));
    vi.doMock("./_core/llm", () => ({
      invokeLLM: vi.fn().mockResolvedValue({ choices: [{ message: { content: [{ type: "text", text: '{"decision":"approve","findings":[]}' }] }, finish_reason: "stop" }] }),
    }));
    vi.resetModules();
    const { evaluateRenderedReel: evalReel } = await import("./services/renderedQa");
    const verdict = await evalReel({ frames: [{ label: "beat1", beatNumber: 1, timestamp: 1, path: fake }], brief: { topic: "brakes" } });
    expect(verdict.critic).toBe("vision");
    expect(verdict.qaState).toBe("completed");
  });

  it("the parser's failure names the finish reason and the head of the reply, so the next skip says why", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rqa-why-"));
    const fake = path.join(dir, "f.jpg");
    await fs.writeFile(fake, Buffer.from("fakejpegbytes"));
    vi.doMock("./_core/llm", () => ({
      invokeLLM: vi.fn().mockResolvedValue({ choices: [{ message: { content: "I cannot evaluate these frames." }, finish_reason: "stop" }] }),
    }));
    vi.resetModules();
    const { callVisionCritic } = await import("./services/renderedQa");
    await expect(
      callVisionCritic({ frames: [{ label: "beat1", beatNumber: 1, timestamp: 1, path: fake }], system: "s", user: "u" }),
    ).rejects.toThrow(/no complete JSON object \(finish_reason=stop, 31 chars: "I cannot evaluate these frames\."\)/);
  });

  it("asks the vision lane for a bounded thinking budget that leaves room for the verdict (2040001 was cut at 573 chars on 4096)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rqa-budget-"));
    const fake = path.join(dir, "f.jpg");
    await fs.writeFile(fake, Buffer.from("fakejpegbytes"));
    const invoke = vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"decision":"approve","findings":[]}' }, finish_reason: "stop" }] });
    vi.doMock("./_core/llm", () => ({ invokeLLM: invoke }));
    vi.resetModules();
    const { callVisionCritic } = await import("./services/renderedQa");
    await callVisionCritic({ frames: [{ label: "beat1", beatNumber: 1, timestamp: 1, path: fake }], system: "s", user: "u" });
    const args = invoke.mock.calls[0][0] as { reasoningEffort?: string; maxTokens?: number };
    // "medium" = 8,192 thinking tokens on Gemini 2.5. Lower fails open (a
    // critic that barely looked); the visible budget must clear the cap by
    // enough for a full findings JSON, or the verdict truncates and holds.
    expect(args.reasoningEffort).toBe("medium");
    expect((args.maxTokens ?? 0) - 8_192).toBeGreaterThanOrEqual(4_096);
  });

  it("control: a well-formed approve is still a completed vision verdict", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rqa-wellformed-"));
    const fake = path.join(dir, "f.jpg");
    await fs.writeFile(fake, Buffer.from("fakejpegbytes"));
    vi.doMock("./_core/llm", () => ({
      invokeLLM: vi.fn().mockResolvedValue({ choices: [{ message: { content: 'Here you go: {"decision":"approve","findings":[]} trailing' } }] }),
    }));
    vi.resetModules();
    const { evaluateRenderedReel: evalReel } = await import("./services/renderedQa");
    const verdict = await evalReel({ frames: [{ label: "beat1", beatNumber: 1, timestamp: 1, path: fake }], brief: { topic: "brakes" } });
    expect(verdict.critic).toBe("vision");
    expect(verdict.qaState).toBe("completed");
    expect(verdict.decision).toBe("approve");
  });

  it("a critic failure yields a SKIPPED verdict, never a fabricated pass/fail", async () => {
    vi.doMock("./_core/llm", () => ({ invokeLLM: vi.fn().mockRejectedValue(new Error("model down")) }));
    vi.resetModules();
    const { evaluateRenderedReel: evalReel } = await import("./services/renderedQa");
    const verdict = await evalReel({ frames: [], brief: {} });
    expect(verdict.critic).toBe("skipped");
    expect(verdict.findings).toHaveLength(0);
  });
});

// ─── Wave B: craft score, confidence, escalation, PIXEL_STATS ──────
//
// Positive control, recorded before the implementation: with `craftScore`
// returning the raw weights (no fold) the deduction tests below fail on
// `plausibility` (expected 0, got 8) and `total` (expected 88, got 100); with
// `escalate` hard-coded "none" the brand/editorial/automotive expectations fail.

import { craftScore, type RenderedFinding } from "./services/renderedQa";
import type { PixelStats } from "./services/renderedPixelStats";

const warn = (code: RenderedFinding["code"], beatNumber: number | null, confidence?: number): RenderedFinding => ({
  beatNumber, code, severity: "warn", description: "d", preserve: [], change: [], ...(confidence === undefined ? {} : { confidence }),
});
const block = (code: RenderedFinding["code"], beatNumber: number | null): RenderedFinding => ({
  beatNumber, code, severity: "block", description: "d", preserve: [], change: [],
});
const px = (flags: string[]): PixelStats => ({
  skipped: false, perFrame: [], flags, analysisWidth: 270,
  thresholds: { softSharpnessMax: 25, dupMeanAbsDiffMax: 3, blackMeanMax: 14, blackStdMax: 8, captionHaloStdMin: 42, captionBandFrac: 0.1, captionHaloFrac: 0.06 },
});

describe("craftScore (README §H2) — a pure fold over findings + pixel flags", () => {
  it("weights are the §H2 weights and sum to 100; a clean reel scores 100 with audio named unobserved", () => {
    const s = craftScore([]);
    expect(Object.values(s.weights).reduce((a, b) => a + b, 0)).toBe(100);
    expect(s.weights).toMatchObject({ openingComposition: 12, mechanicalAccuracy: 12, subjectRealism: 10, plausibility: 8, continuity: 8, cinematography: 8, pacing: 8, motion: 7, typography: 7, audio: 7, brand: 5, nonGeneric: 4, noArtifacts: 4 });
    expect(s.total).toBe(100);
    expect(s.unobserved).toEqual(["audio"]);
  });

  it("a block empties the dimensions its code speaks to", () => {
    const s = craftScore([block("MALFORMED_GEOMETRY", 2)]);
    expect(s.dimensions.plausibility).toBe(0);
    expect(s.dimensions.noArtifacts).toBe(0);
    expect(s.total).toBe(88);
  });

  it("a warn takes half, scaled by the critic's confidence (missing confidence = 1)", () => {
    expect(craftScore([warn("PLASTIC_AI_LOOK", 2, 0.6)]).dimensions.subjectRealism).toBe(7);
    expect(craftScore([warn("PLASTIC_AI_LOOK", 2)]).dimensions.subjectRealism).toBe(5);
  });

  it("weak composition on the HERO beat also costs the opening; on a later beat it does not", () => {
    expect(craftScore([warn("WEAK_COMPOSITION", 1)]).dimensions.openingComposition).toBe(6);
    expect(craftScore([warn("WEAK_COMPOSITION", 3)]).dimensions.openingComposition).toBe(12);
  });

  it("pixel flags deduct: a black opening frame kills the opening; a duplicate beat costs motion and pacing", () => {
    const s = craftScore([], px(["BLACK_FRAME:first", "DUP_FRAME:beat3", "SOFT_FRAME:beat2", "CAPTION_BOX_BUSY:beat2"]));
    expect(s.dimensions.openingComposition).toBe(0);
    expect(s.dimensions.motion).toBe(3.5);
    expect(s.dimensions.pacing).toBe(6);
    expect(s.dimensions.cinematography).toBe(6);
    expect(s.dimensions.subjectRealism).toBe(7.5);
    expect(s.dimensions.typography).toBe(3.5);
    expect(s.total).toBe(100 - 12 - 3.5 - 2 - 2 - 2.5 - 3.5);
  });

  it("deductions accumulate and clamp at zero — never negative", () => {
    const s = craftScore([block("SUBJECT_CONTINUITY", 2), block("ENVIRONMENT_DRIFT", 3), warn("LIGHTING_DRIFT", 4)]);
    expect(s.dimensions.continuity).toBe(0);
    expect(s.total).toBeGreaterThanOrEqual(0);
  });

  it("skipped pixel stats deduct nothing", () => {
    expect(craftScore([], { skipped: true, reason: "x" }).total).toBe(100);
  });
});

describe("clampVerdict — confidence, craft score and escalation on the verdict", () => {
  const raw = (findings: unknown[]) => ({ decision: "approve", findings });
  const f = (code: string, beatNumber: number | null, confidence?: unknown) => ({ beatNumber, code, description: "d", preserve: [], change: [], confidence });

  it("parses and clamps confidence to 0..1; a missing/invalid confidence is left undefined", () => {
    const v = clampVerdict(raw([f("WEAK_COMPOSITION", 1, 1.7), f("PALETTE_DRIFT", 2, -3), f("LIGHTING_DRIFT", 3, "high"), f("GENERIC_STOCK_LOOK", 4)]), 5, "vision");
    expect(v.findings.map((x) => x.confidence)).toEqual([1, 0, undefined, undefined]);
  });

  it("a vision verdict carries craftScore, visionCalls=1 and a deterministic escalate; a skipped one carries NO craft score", () => {
    const v = clampVerdict(raw([]), 5, "vision");
    expect(v.craftScore?.total).toBe(100);
    expect(v.visionCalls).toBe(1);
    expect(v.escalate).toBe("none");
    const s = clampVerdict(raw([]), 5, "skipped");
    expect(s.craftScore).toBeUndefined();
    expect(s.visionCalls).toBe(0);
    expect(s.escalate).toBe("none");
  });

  it("escalation: any craft warn earns its lens (plastic/generic -> brand)", () => {
    expect(clampVerdict(raw([f("PLASTIC_AI_LOOK", 3, 0.95)]), 5, "vision").escalate).toBe("brand");
    expect(clampVerdict(raw([f("GENERIC_STOCK_LOOK", 3)]), 5, "vision").escalate).toBe("brand");
  });

  it("escalation: an uncertain warn on the hero beat earns its lens; a confident one, or one on a later beat, does not", () => {
    expect(clampVerdict(raw([f("WEAK_COMPOSITION", 1, 0.5)]), 5, "vision").escalate).toBe("editorial");
    expect(clampVerdict(raw([f("WEAK_COMPOSITION", null, 0.6)]), 5, "vision").escalate).toBe("editorial");
    expect(clampVerdict(raw([f("WEAK_COMPOSITION", 1, 0.9)]), 5, "vision").escalate).toBe("none");
    expect(clampVerdict(raw([f("WEAK_COMPOSITION", 3, 0.5)]), 5, "vision").escalate).toBe("none");
    expect(clampVerdict(raw([f("CAPTION_OBSTRUCTION", 1, 0.4)]), 5, "vision").escalate).toBe("typography");
  });

  it("escalation: blocks never escalate (the repair is already ordered), and at most ONE lens is chosen by priority", () => {
    expect(clampVerdict(raw([f("MALFORMED_GEOMETRY", 1, 0.3)]), 5, "vision").escalate).toBe("none");
    // automotive (IMPOSSIBLE_PHYSICALITY is a craft warn) outranks brand.
    expect(clampVerdict(raw([f("PLASTIC_AI_LOOK", 2), f("IMPOSSIBLE_PHYSICALITY", 3)]), 5, "vision").escalate).toBe("automotive");
  });

  it("pixel stats are persisted on the verdict and folded into its craft score", () => {
    const v = clampVerdict(raw([]), 5, "vision", px(["BLACK_FRAME:first"]));
    expect(v.pixelStats && !v.pixelStats.skipped && v.pixelStats.flags).toEqual(["BLACK_FRAME:first"]);
    expect(v.craftScore?.dimensions.openingComposition).toBe(0);
  });
});

describe("evaluateRenderedReel — PIXEL_STATS reaches the critic prompt (PROMPT-PACK §13)", () => {
  it("shows the pre-flags, asks for confidence, and the schema requires it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rqa-px-"));
    const fake = path.join(dir, "f.jpg");
    await fs.writeFile(fake, Buffer.from("fakejpegbytes"));
    const spy = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ decision: "approve", findings: [] }) } }] });
    vi.doMock("./_core/llm", () => ({ invokeLLM: spy }));
    vi.resetModules();
    const { evaluateRenderedReel: evalReel } = await import("./services/renderedQa");
    const verdict = await evalReel({
      frames: [{ label: "beat2", beatNumber: 2, timestamp: 1.5, path: fake }],
      brief: { topic: "t" },
      pixelStats: px(["DUP_FRAME:beat2"]),
    });
    const call = spy.mock.calls[0][0];
    expect(call.messages[0].content).toContain("PIXEL_STATS");
    expect(call.messages[0].content).toContain("DUP_FRAME:beat2");
    expect(call.messages[0].content).toContain("confidence (0-1)");
    expect(call.outputSchema.schema.properties.findings.items.required).toContain("confidence");
    expect(verdict.pixelStats && !verdict.pixelStats.skipped && verdict.pixelStats.flags).toEqual(["DUP_FRAME:beat2"]);
    expect(verdict.craftScore?.dimensions.motion).toBe(3.5);
  });

  it("names pre-flags as unavailable when they were skipped — never silently omitted", async () => {
    const spy = vi.fn().mockResolvedValue({ choices: [{ message: { content: "{\"decision\":\"approve\",\"findings\":[]}" } }] });
    vi.doMock("./_core/llm", () => ({ invokeLLM: spy }));
    vi.resetModules();
    const { evaluateRenderedReel: evalReel } = await import("./services/renderedQa");
    await evalReel({ frames: [], brief: {}, pixelStats: { skipped: true, reason: "sharp exploded" } });
    expect(spy.mock.calls[0][0].messages[0].content).toContain("PIXEL_STATS: unavailable (sharp exploded)");
  });
});
