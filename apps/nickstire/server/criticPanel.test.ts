/**
 * Specialist critic panel (milestone 9 §59) — the merge is the load-bearing
 * logic: dedupe cross-lens findings, keep the strongest severity, and let ANY
 * block force repair. A single hard fail must never be averaged away by clean
 * lenses (the directive's core objection to one composite score).
 */
import { describe, expect, it } from "vitest";
import { CRITIC_LENSES, mergePanel, type CriticLens } from "./services/criticPanel";
import type { RenderedQaVerdict } from "./services/renderedQa";

const v = (findings: RenderedQaVerdict["findings"], critic: "vision" | "skipped" = "vision"): RenderedQaVerdict => ({
  decision: findings.some((f) => f.severity === "block") ? "repair" : "approve",
  findings,
  framesEvaluated: 8,
  evaluatedAt: "t",
  critic,
  qaState: critic === "skipped" ? "unavailable" : "completed",
});

describe("mergePanel", () => {
  it("all lenses clean -> approve, nothing merged", () => {
    const r = mergePanel([
      { lens: "automotive", verdict: v([]) },
      { lens: "typography", verdict: v([]) },
    ]);
    expect(r.decision).toBe("approve");
    expect(r.findings).toEqual([]);
    expect(r.lensesRun).toEqual(["automotive", "typography"]);
  });

  it("ONE block among six clean lenses still forces repair (never averaged)", () => {
    const block = { beatNumber: 3, code: "MALFORMED_GEOMETRY" as const, severity: "block" as const, description: "warped wheel", preserve: [], change: [] };
    const r = mergePanel([
      { lens: "visual_continuity", verdict: v([]) },
      { lens: "automotive", verdict: v([block]) },
      { lens: "editorial", verdict: v([]) },
      { lens: "typography", verdict: v([]) },
      { lens: "brand", verdict: v([]) },
      { lens: "strategic", verdict: v([]) },
    ]);
    expect(r.decision).toBe("repair");
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].code).toBe("MALFORMED_GEOMETRY");
  });

  it("the same (code,beat) from two lenses dedupes and unions the lens tags", () => {
    const finding = { beatNumber: 1, code: "GENERATED_TEXT_ARTIFACT" as const, severity: "block" as const, description: "gibberish", preserve: [], change: [] };
    const r = mergePanel([
      { lens: "typography", verdict: v([finding]) },
      { lens: "visual_continuity", verdict: v([{ ...finding }]) },
    ]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].lenses.sort()).toEqual(["typography", "visual_continuity"]);
  });

  it("stronger severity wins when lenses disagree on the same finding", () => {
    const key = { beatNumber: 2, code: "PALETTE_DRIFT" as const, description: "drift", preserve: [], change: [] };
    const r = mergePanel([
      { lens: "brand", verdict: v([{ ...key, severity: "warn" }]) },
      { lens: "visual_continuity", verdict: v([{ ...key, severity: "block" }]) },
    ]);
    expect(r.findings[0].severity).toBe("block");
    expect(r.decision).toBe("repair");
  });

  it("a skipped lens is recorded, not counted as clean", () => {
    const r = mergePanel([
      { lens: "automotive", verdict: v([], "skipped") },
      { lens: "typography", verdict: null },
      { lens: "brand", verdict: v([]) },
    ]);
    expect(r.lensesSkipped.sort()).toEqual(["automotive", "typography"]);
    expect(r.lensesRun).toEqual(["brand"]);
  });

  it("findings sort blocks before warns", () => {
    const warn = { beatNumber: 1, code: "WEAK_COMPOSITION" as const, severity: "warn" as const, description: "w", preserve: [], change: [] };
    const block = { beatNumber: 2, code: "HUMAN_PRESENT" as const, severity: "block" as const, description: "b", preserve: [], change: [] };
    const r = mergePanel([{ lens: "composition", verdict: v([warn, block]) }]);
    expect(r.findings[0].severity).toBe("block");
    expect(r.findings[1].severity).toBe("warn");
  });

  it("every lens covers a real concern (7 lenses defined)", () => {
    const lenses = Object.keys(CRITIC_LENSES) as CriticLens[];
    expect(lenses).toHaveLength(7);
    for (const l of lenses) expect(CRITIC_LENSES[l].focus.length).toBeGreaterThan(20);
  });
});

// ─── Wave B: adaptive escalation of ONE lens, flag-gated ───────────
//
// Budget contract (README §L.2): with RENDERED_QA_SPECIALIST off the vision
// call count is exactly what it was (1 per reel); with it on it is at most +1.
// Positive control: with `escalateIfNeeded` ignoring `enabled`, the "flag
// off" test fails (spy called once, expected zero).

import { vi, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

afterEach(() => {
  vi.doUnmock("./_core/llm");
  vi.resetModules();
});

async function freshWithVision(reply: unknown) {
  const spy = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(reply) } }] });
  vi.doMock("./_core/llm", () => ({ invokeLLM: spy }));
  vi.resetModules();
  const renderedQa = await import("./services/renderedQa");
  const panel = await import("./services/criticPanel");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "panel-"));
  const fake = path.join(dir, "f.jpg");
  await fs.writeFile(fake, Buffer.from("fakejpegbytes"));
  const frames = [{ label: "beat1", beatNumber: 1, timestamp: 1, path: fake }];
  return { spy, renderedQa, panel, frames };
}

const craftWarn = { decision: "approve", findings: [{ beatNumber: 2, code: "PLASTIC_AI_LOOK", description: "waxy rubber", preserve: [], change: [], confidence: 0.8 }] };

describe("escalateIfNeeded — vision-call accounting", () => {
  it("flag OFF: no lens runs, no extra call, verdict returned untouched (visionCalls stays 1)", async () => {
    const { spy, renderedQa, panel, frames } = await freshWithVision({ decision: "approve", findings: [] });
    const general = renderedQa.clampVerdict(craftWarn, 3, "vision");
    expect(general.escalate).toBe("brand");
    const out = await panel.escalateIfNeeded(general, frames, { brief: {} }, { enabled: false });
    expect(spy).toHaveBeenCalledTimes(0);
    expect(out).toBe(general);
    expect(out.visionCalls).toBe(1);
    // Env unset and no explicit flag: still off.
    delete process.env.RENDERED_QA_SPECIALIST;
    expect(await panel.escalateIfNeeded(general, frames, { brief: {} })).toBe(general);
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("flag ON: exactly ONE lens call, the one the verdict asked for, merged and counted (visionCalls = 2)", async () => {
    const { spy, renderedQa, panel, frames } = await freshWithVision({
      decision: "approve",
      findings: [{ beatNumber: 2, code: "GENERIC_STOCK_LOOK", description: "any shop", preserve: [], change: [], confidence: 0.9 }],
    });
    const general = renderedQa.clampVerdict(craftWarn, 3, "vision");
    const out = await panel.escalateIfNeeded(general, frames, { brief: { topic: "salt" } }, { enabled: true });
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0][0];
    expect(call.messages[0].content).toContain(panel.CRITIC_LENSES.brand.focus);
    expect(call.messages[0].content).toContain("PLASTIC_AI_LOOK on beat 2"); // the lens sees the prior finding
    expect(call.messages[1].content[0].text).toContain("brand lens");
    expect(out.visionCalls).toBe(2);
    expect(out.specialist).toEqual({ lens: "brand", critic: "vision", findingsAdded: 1 });
    expect(out.findings.map((f) => f.code).sort()).toEqual(["GENERIC_STOCK_LOOK", "PLASTIC_AI_LOOK"]);
    expect(out.decision).toBe("approve"); // craft warns still never order a repair
    expect(out.craftScore?.dimensions.nonGeneric).toBe(2.2); // refolded with the lens finding (4 - 4*0.5*0.9)
  });

  it("flag ON but the verdict asked for no lens: zero extra calls", async () => {
    const { spy, renderedQa, panel, frames } = await freshWithVision({ decision: "approve", findings: [] });
    const general = renderedQa.clampVerdict({ decision: "approve", findings: [] }, 3, "vision");
    expect(general.escalate).toBe("none");
    expect(await panel.escalateIfNeeded(general, frames, { brief: {} }, { enabled: true })).toBe(general);
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("flag ON and a skipped general critic: nothing to escalate, zero calls", async () => {
    const { spy, renderedQa, panel, frames } = await freshWithVision({ decision: "approve", findings: [] });
    const skipped = renderedQa.clampVerdict({ decision: "approve", findings: [] }, 3, "skipped");
    expect(await panel.escalateIfNeeded(skipped, frames, { brief: {} }, { enabled: true })).toBe(skipped);
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("a lens BLOCK forces repair; a lens failure is counted as spend and recorded skipped, never as clean", async () => {
    const { renderedQa, panel, frames } = await freshWithVision({
      decision: "repair",
      findings: [{ beatNumber: 1, code: "MALFORMED_GEOMETRY", description: "warped", preserve: [], change: [], confidence: 0.9 }],
    });
    const general = renderedQa.clampVerdict(
      { decision: "approve", findings: [{ beatNumber: 1, code: "IMPOSSIBLE_PHYSICALITY", description: "no shadow", preserve: [], change: [], confidence: 0.5 }] },
      3, "vision",
    );
    expect(general.escalate).toBe("automotive");
    const out = await panel.escalateIfNeeded(general, frames, { brief: {} }, { enabled: true });
    expect(out.decision).toBe("repair");
    expect(out.findings[0].code).toBe("MALFORMED_GEOMETRY");
    expect(out.craftScore?.dimensions.plausibility).toBe(0);

    // Failure path: the lens call rejects.
    const failing = vi.fn().mockRejectedValue(new Error("model down"));
    vi.doMock("./_core/llm", () => ({ invokeLLM: failing }));
    vi.resetModules();
    const rq2 = await import("./services/renderedQa");
    const panel2 = await import("./services/criticPanel");
    const general2 = rq2.clampVerdict(craftWarn, 3, "vision");
    const out2 = await panel2.escalateIfNeeded(general2, frames, { brief: {} }, { enabled: true });
    expect(failing).toHaveBeenCalledTimes(1);
    expect(out2.visionCalls).toBe(2);
    expect(out2.specialist).toEqual({ lens: "brand", critic: "skipped", findingsAdded: 0 });
    expect(out2.decision).toBe("approve");
    expect(out2.findings.map((f) => f.code)).toEqual(["PLASTIC_AI_LOOK"]);
  });

  it("the env flag alone (RENDERED_QA_SPECIALIST=true) arms escalation when the caller passes no explicit option", async () => {
    const { spy, renderedQa, panel, frames } = await freshWithVision({ decision: "approve", findings: [] });
    vi.stubEnv("RENDERED_QA_SPECIALIST", "true");
    const general = renderedQa.clampVerdict(craftWarn, 3, "vision");
    const out = await panel.escalateIfNeeded(general, frames, { brief: {} });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out.visionCalls).toBe(2);
  });

  it("END TO END: general critic + escalation = 2 calls with the flag on, 1 with it off", async () => {
    const { spy, renderedQa, panel, frames } = await freshWithVision(craftWarn);
    const general = await renderedQa.evaluateRenderedReel({ frames, brief: {} });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(general.escalate).toBe("brand");
    await panel.escalateIfNeeded(general, frames, { brief: {} }, { enabled: false });
    expect(spy).toHaveBeenCalledTimes(1);
    const out = await panel.escalateIfNeeded(general, frames, { brief: {} }, { enabled: true });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(out.visionCalls).toBe(2);
  });
});
