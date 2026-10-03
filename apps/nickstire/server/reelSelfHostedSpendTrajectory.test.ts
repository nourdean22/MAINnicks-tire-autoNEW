/**
 * self_hosted (NOUR Video Forge) spend trajectory · 2026-10-03
 *
 * Cost → reserve() → daily-ceiling guard → persisted row, and cost POLICY →
 * repair routing. The unit tests in mediaModelRegistry.test.ts prove the
 * arithmetic; this file proves it reaches the ledger and the repair gate, which
 * is where every previous pricing defect in this repo actually lived
 * (reelClipCost.test.ts: "the bug was never in the arithmetic").
 *
 * Two regressions this pins:
 *   1. A naive self_hosted lane would have been priced at the Seedance estimate
 *      (generationLedger's old `provider !== "veo"` fallthrough). Assert it is
 *      NOT, in the persisted row.
 *   2. Pre-authorizing a rented GPU pool removes the per-repair human tap. It
 *      must NOT remove the daily ceiling.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { COST_ESTIMATES_USD } from "./services/generationLedger";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("./db");
  vi.resetModules();
});

function fakeLedgerDb(state: { rows: Array<Record<string, unknown>> }) {
  let selectCount = 0;
  return {
    select: () => {
      selectCount++;
      if (selectCount >= 2) {
        // post-insert re-sum: drive the budget branch from what was persisted
        const total = state.rows.reduce((sum, r) => sum + Number(r.estimatedCostUsd ?? 0), 0);
        return { from: () => ({ where: () => Promise.resolve([{ total: String(total) }]) }) };
      }
      return {
        from: () => ({
          where: () => {
            const p = Promise.resolve(state.rows) as Promise<unknown> & { limit: (n: number) => Promise<unknown> };
            p.limit = () => Promise.resolve([]);
            return p;
          },
        }),
      };
    },
    insert: () => ({ values: (v: Record<string, unknown>) => { state.rows.push(v); return Promise.resolve({}); } }),
    update: () => ({ set: (patch: Record<string, unknown>) => ({ where: () => { Object.assign(state.rows[state.rows.length - 1] ?? {}, patch); return Promise.resolve({}); } }) }),
  };
}

async function reserveSelfHosted(beats: number, dailyBudgetUsd?: number) {
  const state = { rows: [] as Array<Record<string, unknown>> };
  vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(fakeLedgerDb(state)) }));
  vi.resetModules();
  const ledger = await import("./services/generationLedger");
  const { reelLedgerModel } = await import("./services/reelPipeline");
  const row = await ledger.reserve({
    actionId: "reel_job_self_hosted",
    provider: "self_hosted",
    model: reelLedgerModel("self_hosted"),
    operation: "reel_clips",
    estimatedCostUsd: beats * ledger.reelClipCostUsd("self_hosted"),
    ...(dailyBudgetUsd !== undefined ? { dailyBudgetUsd } : {}),
  });
  return { row, state, ledger };
}

describe("self_hosted spend trajectory · the persisted amount is GPU compute, not Seedance", () => {
  it("persists the reservation at profile GPU-seconds × $/GPU-hour, under the model's own name", async () => {
    vi.stubEnv("VIDEO_FORGE_PROFILE", "ltx-2.5-distilled");
    vi.stubEnv("VIDEO_FORGE_USD_PER_GPU_HOUR", "2.40");
    const beats = 6;
    const { row, state } = await reserveSelfHosted(beats);
    const expected = beats * (120 / 3600) * 2.4;
    expect(row!.estimatedCostUsd).toBeCloseTo(expected, 10);
    expect(row!.estimatedCostUsd).not.toBeCloseTo(beats * COST_ESTIMATES_USD.seedance_clip, 6);
    expect(state.rows[0]).toMatchObject({ provider: "self_hosted", model: "video_forge:ltx-2.5-distilled" });
  });

  it("a model switch is measurable: Wan and LTX reserve different amounts", async () => {
    vi.stubEnv("VIDEO_FORGE_PROFILE", "ltx-2.5-distilled");
    const ltx = (await reserveSelfHosted(6)).row!.estimatedCostUsd;
    vi.stubEnv("VIDEO_FORGE_PROFILE", "wan2.2-ti2v-5b");
    const wan = (await reserveSelfHosted(6)).row!.estimatedCostUsd;
    expect(ltx).not.toBeCloseTo(wan, 6);
  });

  it("pre-authorizing the GPU pool removes the human tap, NOT the daily ceiling", async () => {
    vi.stubEnv("VIDEO_FORGE_PROFILE", "ltx-2.5-dfr");
    vi.stubEnv("VIDEO_FORGE_POOL_PREAUTHORIZED", "true");
    const beats = 6;
    const { ledger } = await reserveSelfHosted(0);
    expect(ledger.reelClipCostPolicy("self_hosted").requiresSpendApproval).toBe(false);
    const price = beats * ledger.reelClipCostUsd("self_hosted");
    await expect(reserveSelfHosted(beats, price / 2)).rejects.toThrow(/BUDGET_DAILY_EXCEEDED/);
    const { row } = await reserveSelfHosted(beats, price * 2);
    expect(row).not.toBeNull();
  });

  it("settle() books the MEASURED compute (an actual), clearing the estimate flag", async () => {
    vi.stubEnv("VIDEO_FORGE_PROFILE", "ltx-2.5-distilled");
    const { state, ledger } = await reserveSelfHosted(6);
    await ledger.settle("reel_job_self_hosted", 0.137);
    expect(state.rows[0]).toMatchObject({ status: "settled", actualCostUsd: "0.1370", isEstimate: false });
  });
});

describe("self_hosted cost POLICY reaches repair routing", () => {
  const finding = { code: "PLASTIC_AI_LOOK", beatNumber: 2, severity: "block" } as never;

  it("rented pool, not pre-authorized → beat regen is routed as PAID (operator hold)", async () => {
    const { reelClipCostPolicy } = await import("./services/generationLedger");
    const { routeFinding } = await import("./services/repairRouter");
    const policy = reelClipCostPolicy("self_hosted", { VIDEO_FORGE_PROFILE: "ltx-2.5-distilled" } as NodeJS.ProcessEnv);
    expect(routeFinding(finding, { beatRegenCostsCredits: policy.requiresSpendApproval }).costsProviderCredits).toBe(true);
  });

  it("pre-authorized pool → beat regen routes as autonomous repair while still costing real compute", async () => {
    const { reelClipCostPolicy } = await import("./services/generationLedger");
    const { routeFinding } = await import("./services/repairRouter");
    const env = { VIDEO_FORGE_PROFILE: "ltx-2.5-distilled", VIDEO_FORGE_POOL_PREAUTHORIZED: "true" } as NodeJS.ProcessEnv;
    const policy = reelClipCostPolicy("self_hosted", env);
    expect(policy.estimatedComputeCostUsd).toBeGreaterThan(0);
    expect(routeFinding(finding, { beatRegenCostsCredits: policy.requiresSpendApproval }).costsProviderCredits).toBe(false);
  });

  it("the paid vendors' routing is unchanged: same decision as the old `cost > 0` proxy", async () => {
    const { reelClipCostPolicy, reelClipCostUsd } = await import("./services/generationLedger");
    for (const p of ["veo", "higgsfield", "template_stock"]) {
      expect(reelClipCostPolicy(p, {} as NodeJS.ProcessEnv).requiresSpendApproval, p).toBe(reelClipCostUsd(p, {} as NodeJS.ProcessEnv) > 0);
    }
  });

  it("qualityGate asks the POLICY, not cost > 0", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./services/qualityGate.ts", import.meta.url), "utf8");
    expect(src).toContain("reelClipCostPolicy(await selectReelVideoProvider()).requiresSpendApproval");
    expect(src).not.toMatch(/reelClipCostUsd\(await selectReelVideoProvider\(\)\) > 0/);
  });
});
