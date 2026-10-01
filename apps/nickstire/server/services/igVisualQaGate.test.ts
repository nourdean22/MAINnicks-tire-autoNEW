import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { visualQaGate, visualQaGateEnabled } from "./igVisualQaGate";

const MIN = 0.6;
const on = { enabled: true, minProLook: MIN };

describe("visualQaGate — UNKNOWN is not PASS", () => {
  it("POSITIVE CONTROL: the live 2026-10-01 shape (AI image, critic skipped) is HELD", () => {
    const d = visualQaGate("ai", { proLook: null, skipped: true, note: "image-eval skipped (no REPLICATE_API_KEY) — dryrun review is the gate" }, on);
    expect(d.block).toBe(true);
    expect(d.state).toBe("unknown");
    expect(d.reason).toMatch(/UNKNOWN is not PASS/);
  });

  it("AI image with a null score but not flagged skipped is still UNKNOWN", () => {
    expect(visualQaGate("ai", { proLook: null, skipped: false, note: "" }, on).state).toBe("unknown");
  });

  it("AI image scored below the floor blocks as scored_weak", () => {
    const d = visualQaGate("ai", { proLook: 0.42, skipped: false, note: "garbled text on the tire" }, on);
    expect(d).toMatchObject({ block: true, state: "scored_weak" });
  });

  it("AI image scored at/above the floor clears", () => {
    expect(visualQaGate("ai", { proLook: MIN, skipped: false, note: "" }, on)).toMatchObject({ block: false, state: "scored_clear" });
    expect(visualQaGate("ai", { proLook: 0.91, skipped: false, note: "" }, on).block).toBe(false);
  });

  it("deterministic poster clears without a vision verdict", () => {
    const d = visualQaGate("poster", { proLook: null, skipped: true, note: "branded poster — deterministic template, eval skipped" }, on);
    expect(d).toMatchObject({ block: false, state: "deterministic" });
  });

  it("real shop asset clears deterministically and the reason names the asset (§K.3)", () => {
    const d = visualQaGate("real", { proLook: null, skipped: true, note: "real shop asset ma_rotor — operator-captured photo, eval skipped" }, { ...on, realAssetId: "ma_rotor" });
    expect(d).toMatchObject({ block: false, state: "deterministic" });
    expect(d.reason).toBe("real shop asset ma_rotor — operator-captured photo, rights real_shop");
    // Without the id the gate still clears but says the id is missing rather than inventing one.
    expect(visualQaGate("real", { proLook: null, skipped: true, note: "" }, on).reason).toContain("(id missing)");
  });

  it("kill switch clears everything and says so", () => {
    const d = visualQaGate("ai", { proLook: null, skipped: true, note: "" }, { enabled: false, minProLook: MIN });
    expect(d).toMatchObject({ block: false, state: "disabled" });
    expect(d.reason).toContain("IG_VISUAL_QA_GATE=false");
  });
});

describe("visualQaGateEnabled", () => {
  afterEach(() => { delete process.env.IG_VISUAL_QA_GATE; });
  it("defaults ON; only the literal 'false' disables", () => {
    expect(visualQaGateEnabled({})).toBe(true);
    expect(visualQaGateEnabled({ IG_VISUAL_QA_GATE: "false" })).toBe(false);
    expect(visualQaGateEnabled({ IG_VISUAL_QA_GATE: "0" })).toBe(true);
  });
});

describe("wiring: the gate sits on the LIVE lane of igAutopost, after the dryrun return", () => {
  const src = fs.readFileSync(path.join(__dirname, "igAutopost.ts"), "utf8");
  it("gate is called with the image kind and the eval record, and blocks before postToInstagram", () => {
    const dryrunReturn = src.indexOf('status: "dryrun",\n        archetype: post.archetype');
    const gateCall = src.indexOf("visualQaGate(image.kind, scores.image");
    const liveBranch = src.indexOf("// ── LIVE ── post to IG (JPEG url) + FB");
    expect(dryrunReturn).toBeGreaterThan(0);
    expect(gateCall).toBeGreaterThan(dryrunReturn);
    expect(liveBranch).toBeGreaterThan(gateCall);
    expect(src).toMatch(/if \(visualGate\.block\) \{[\s\S]*?status: "aborted"[\s\S]*?error: `visual-qa-\$\{visualGate\.state\}/);
  });
  it("the critic no longer requires Replicate: Gemini is the second rung", () => {
    expect(src).toMatch(/process\.env\.GEMINI_API_KEY \? "gemini" : null/);
    expect(src).not.toMatch(/image-eval skipped \(no REPLICATE_API_KEY\) — dryrun review is the gate/);
  });
});

describe("evalImage never defaults a scoreless reply to a pass", () => {
  it("source: a missing SCORE line returns skipped (UNKNOWN), not 0.65", () => {
    const src = fs.readFileSync(path.join(__dirname, "igAutopost.ts"), "utf8");
    expect(src).not.toMatch(/: 65;/);
    expect(src).toMatch(/returned no SCORE line — verdict UNKNOWN/);
  });
});
