/**
 * Rendered creative QA — defect vocabulary, verdict clamping, and REAL frame
 * extraction against a synthesized video (skipped when ffmpeg is absent).
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
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
    const userParts = call.messages[1].content;
    expect(userParts.some((p: { type: string }) => p.type === "image_url")).toBe(true);
    expect(verdict.decision).toBe("repair");
    expect(verdict.findings[0].code).toBe("HUMAN_PRESENT");
    expect(verdict.critic).toBe("vision");
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
