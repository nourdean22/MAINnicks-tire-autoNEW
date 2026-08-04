/**
 * The repair path must render on the lane the job is actually on, and bill it
 * at that lane's price.
 *
 * selectiveRepair hardcoded `provider: "higgsfield"`, `model: "seedance1_5"`,
 * `COST_ESTIMATES_USD.seedance_clip` and a direct import of higgsfieldStudio —
 * on a path that runs for EVERY reel, regardless of which provider generated
 * it. Two consequences, and the second is the expensive one:
 *
 *   1. THE LEDGER LIED. A repair on a Veo job was filed as Higgsfield /
 *      seedance1_5 at the Seedance price, so provider comparisons and the daily
 *      budget both counted the wrong number — and a repair on a template_stock
 *      job, which costs nothing at all, consumed real budget and could push
 *      maxGenerationCostPerDayUsd over for renders that are free.
 *
 *   2. IT ACTUALLY CALLED HIGGSFIELD. A shop pinned to the free local lane got
 *      a real paid API render the moment any beat needed repair. The provider
 *      pin is a deliberate cost decision (prod has been pinned to higgsfield at
 *      a measured per-reel cost since 2026-07-31) and the repair path was
 *      quietly overriding it in the other direction.
 *
 * The generation pipeline already selects per run and already refuses a
 * provider it has no branch for, by name, rather than falling through to a
 * default that spends money. These pin that repair now does both, and that the
 * two paths share ONE ledger-model map so adding a provider cannot leave repair
 * mislabelling it.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reelClipCostUsd, COST_ESTIMATES_USD } from "./services/generationLedger";
import { reelLedgerModel } from "./services/reelPipeline";

const REPAIR = readFileSync(join(__dirname, "services", "selectiveRepair.ts"), "utf8");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the price follows the lane", () => {
  it("bills the free local lane at zero, not at the Seedance rate", () => {
    expect(reelClipCostUsd("template_stock")).toBe(COST_ESTIMATES_USD.template_stock_clip);
    expect(reelClipCostUsd("template_stock")).toBe(0);
    expect(reelClipCostUsd("template_stock")).not.toBe(COST_ESTIMATES_USD.seedance_clip);
  });

  it("bills Veo per second, which a flat per-clip constant cannot express", () => {
    vi.stubEnv("REEL_VEO_DURATION", "8");
    vi.stubEnv("REEL_VEO_USD_PER_SECOND", "0.15");
    expect(reelClipCostUsd("veo", process.env)).toBeCloseTo(1.2, 5);
    expect(reelClipCostUsd("veo", process.env)).not.toBe(COST_ESTIMATES_USD.seedance_clip);
  });

  it("still bills Higgsfield at the Seedance rate — the prod pin is unchanged", () => {
    expect(reelClipCostUsd("higgsfield")).toBe(COST_ESTIMATES_USD.seedance_clip);
  });
});

describe("the ledger model follows the lane", () => {
  it("names each provider's model distinctly, from ONE shared map", () => {
    expect(reelLedgerModel("higgsfield")).toBe("seedance1_5");
    expect(reelLedgerModel("template_stock")).toBe("ffmpeg_local");
    expect(reelLedgerModel("veo")).toMatch(/^veo-/);
  });
});

describe("repair reserves, settles and gates on the ACTIVE provider", () => {
  it("no longer hardcodes the provider or the model in the reservation", () => {
    expect(REPAIR).toMatch(/provider: repairProvider,/);
    expect(REPAIR).toMatch(/model: reelLedgerModel\(repairProvider\),/);
    expect(REPAIR).not.toMatch(/provider: "higgsfield"/);
    expect(REPAIR).not.toMatch(/model: "seedance1_5"/);
  });

  it("reserves and settles the SAME figure — a mismatch is how a ledger drifts", () => {
    expect(REPAIR).toMatch(/const repairCostUsd = reelClipCostUsd\(repairProvider\);/);
    expect(REPAIR).toMatch(/estimatedCostUsd: repairCostUsd,/);
    expect(REPAIR).toMatch(/await settle\(reservationId, repairCostUsd\);/);
  });

  it("prices the policy gate on the active lane too, not on a constant", () => {
    // Hardcoding Seedance here meant the gate could REFUSE a template_stock
    // repair — one that costs nothing — on the grounds of a budget it would
    // never touch. The gate is only as good as the number it is handed.
    expect(REPAIR).toMatch(/estimatedCostUsd: reelClipCostUsd\(await selectReelVideoProvider\(\)\),/);
    expect(REPAIR).not.toMatch(/estimatedCostUsd: COST_ESTIMATES_USD\.seedance_clip/);
  });
});

describe("repair renders on the lane, and refuses the ones it has no branch for", () => {
  it("routes the free lane to local ffmpeg instead of a paid API", () => {
    expect(REPAIR).toMatch(/if \(repairProvider === "template_stock"\)/);
    expect(REPAIR).toMatch(/generateTemplateStockClip\(\{ beatNumber: entry\.beatNumber \}\)/);
  });

  it("passes NO prompt to the free lane — assembly owns the on-screen text", () => {
    // The local lane takes no text. Sending the repair prompt would print
    // internal instructions on screen over the caption assembly already burns,
    // which is the defect that lane shipped with and had removed.
    const block = REPAIR.slice(REPAIR.indexOf('if (repairProvider === "template_stock")'), REPAIR.indexOf('} else if (repairProvider === "higgsfield")'));
    expect(block).not.toMatch(/buildRepairPrompt/);
    expect(block).not.toMatch(/negativePrompt/);
  });

  it("carries the durable-storage precondition the free lane needs", () => {
    // template_stock renders to local disk and re-hosts. Without durable
    // storage the clip lands on ephemeral disk and a redeploy destroys it —
    // worse on a repair than on a first render, because the ORIGINAL clip has
    // already been invalidated by the time this runs.
    expect(REPAIR).toMatch(/assertDurableStorageForGeneration\(`reel job \$\{job\.id\} template_stock beat repair`\)/);
  });

  it("refuses an unbranched provider by name rather than falling through to one that costs money", () => {
    expect(REPAIR).toMatch(/beat repair has no branch for REEL_VIDEO_PROVIDER/);
    expect(REPAIR).toMatch(/must not fall through to another provider/);
  });

  it("reaches higgsfieldStudio ONLY from inside the higgsfield branch", () => {
    const idx = REPAIR.indexOf('await import("./higgsfieldStudio")');
    expect(idx).toBeGreaterThan(-1);
    const branchIdx = REPAIR.indexOf('} else if (repairProvider === "higgsfield") {');
    expect(branchIdx).toBeGreaterThan(-1);
    expect(idx).toBeGreaterThan(branchIdx);
    // and only once — a second import site would be a second way to bypass the lane
    expect(REPAIR.split('await import("./higgsfieldStudio")').length - 1).toBe(1);
  });
});
