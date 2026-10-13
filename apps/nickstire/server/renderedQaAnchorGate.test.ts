/**
 * Continuity findings may block only against a visual anchor (2026-10-12), and
 * the critic is given the same beat text the generator received.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beatsDocFor, clampVerdict, visualWorldAnchored } from "./services/renderedQa";

afterEach(() => {
  vi.doUnmock("./_core/llm");
  vi.resetModules();
});

const CONT = { beatNumber: 3, code: "SUBJECT_CONTINUITY", description: "the tread pattern changes between beats", preserve: [], change: [] };
const DRIFT = { beatNumber: 2, code: "ENVIRONMENT_DRIFT", description: "the background turns from shop to street", preserve: [], change: [] };
const HUMAN = { beatNumber: 1, code: "HUMAN_PRESENT", description: "a face is visible at the edge", preserve: [], change: [] };

describe("continuity findings block only against an anchor", () => {
  it("CANARY: no anchor, only continuity findings -> no block, verdict approves", () => {
    const v = clampVerdict({ decision: "repair", findings: [CONT, DRIFT] }, 7, "vision", null, { visualAnchored: false });
    expect(v.findings.filter((f) => f.severity === "block")).toEqual([]);
    expect(v.decision).toBe("approve");
  });

  it("the same continuity findings WITH an anchor still block and order a repair", () => {
    const v = clampVerdict({ decision: "repair", findings: [CONT, DRIFT] }, 7, "vision", null, { visualAnchored: true });
    expect(v.findings.map((f) => f.severity)).toEqual(["block", "block"]);
    expect(v.decision).toBe("repair");
  });

  it("CONTROL: no anchor does not soften a non-continuity block", () => {
    const v = clampVerdict({ decision: "approve", findings: [HUMAN] }, 7, "vision", null, { visualAnchored: false });
    expect(v.findings[0].severity).toBe("block");
    expect(v.decision).toBe("repair");
  });

  it("CONTROL: an omitted anchor option keeps the registry severity for existing callers", () => {
    const v = clampVerdict({ decision: "approve", findings: [CONT] }, 7, "vision");
    expect(v.findings[0].severity).toBe("block");
    expect(v.decision).toBe("repair");
  });

  it("CANARY end to end: no visualWorld approves continuity-only; lockedInvariants or heroFrameUrl blocks", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rqa-anchor-"));
    const fake = path.join(dir, "f.jpg");
    await fs.writeFile(fake, Buffer.from("fakejpegbytes"));
    const frames = [{ label: "beat1", beatNumber: 1, timestamp: 1, path: fake }];
    const content = JSON.stringify({ decision: "repair", findings: [CONT] });
    vi.doMock("./_core/llm", () => ({
      invokeLLM: vi.fn().mockResolvedValue({ choices: [{ message: { content }, finish_reason: "stop" }] }),
    }));
    vi.resetModules();
    const { evaluateRenderedReel } = await import("./services/renderedQa");

    const bare = await evaluateRenderedReel({ frames, brief: { topic: "brakes" } });
    expect(bare.critic).toBe("vision");
    expect(bare.findings.filter((f) => f.severity === "block")).toEqual([]);
    expect(bare.decision).toBe("approve");

    const locked = await evaluateRenderedReel({ frames, brief: { topic: "brakes", visualWorld: { lockedInvariants: "graphite shop, gold rim light" } } });
    expect(locked.decision).toBe("repair");
    expect(locked.findings[0].severity).toBe("block");

    const hero = await evaluateRenderedReel({ frames, brief: { topic: "brakes", visualWorld: { heroFrameUrl: "https://nickstire.org/hero.jpg" } } });
    expect(hero.decision).toBe("repair");
  });
});

describe("the anchor is one rule for every critic path", () => {
  it("a brief is anchored by a locked invariant or a hero still, and by neither otherwise", () => {
    expect(visualWorldAnchored({ topic: "brakes", visualWorld: { lockedInvariants: "graphite shop" } })).toBe(true);
    expect(visualWorldAnchored({ topic: "brakes", visualWorld: { heroFrameUrl: "https://nickstire.org/hero.jpg" } })).toBe(true);
    expect(visualWorldAnchored({ topic: "brakes" })).toBe(false);
  });

  it("the specialist lens path passes the anchor, so its continuity findings follow the same rule", () => {
    // The continuity lens owns SUBJECT_CONTINUITY and ENVIRONMENT_DRIFT, so its clampVerdict must carry the anchor too.
    const panel = readFileSync(path.join(__dirname, "services", "criticPanel.ts"), "utf8");
    expect(panel).toContain('clampVerdict(parsed, frames.length, "vision", undefined, { visualAnchored: visualWorldAnchored(context.brief) })');
  });
});

describe("the critic judges against the beat the generator received", () => {
  it("beatsDocFor carries the motion and audioCue, not only the visual", () => {
    const doc = beatsDocFor({
      storyboardBeats: [{ beatNumber: 2, visual: "worn tread on a lift", motion: "slow push-in", audioCue: "air wrench in the distance" }],
    });
    expect(doc).toContain("worn tread on a lift");
    expect(doc).toContain("slow push-in");
    expect(doc).toContain("air wrench in the distance");
  });

  it("CONTROL: a beat with no motion or audioCue renders the visual alone", () => {
    expect(beatsDocFor({ storyboardBeats: [{ beatNumber: 1, visual: "tread close-up" }] })).toBe("beat 1: tread close-up");
  });
});
