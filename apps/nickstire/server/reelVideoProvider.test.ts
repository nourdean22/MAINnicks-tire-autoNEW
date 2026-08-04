import { describe, expect, it, vi, afterEach } from "vitest";

/**
 * Reel video provider selection. The pipeline was hardwired to Veo, so a dead
 * Gemini key blocked reels even with a funded Higgsfield plan loaded. The
 * selector must (a) honor an explicit REEL_VIDEO_PROVIDER, and (b) auto-fall to
 * Higgsfield when Veo has no key but Higgsfield is credentialed.
 */
const { hasHiggsfield } = vi.hoisted(() => ({ hasHiggsfield: { value: false } }));
vi.mock("./services/higgsfieldStudio", () => ({
  getHiggsfieldCredentialsJson: async () => (hasHiggsfield.value ? '{"key":"x"}' : null),
}));

import { selectReelVideoProvider } from "./services/reelPipeline";

function clearVeo() {
  for (const k of ["GEMINI_API_KEY", "GOOGLE_AI_API_KEY", "GOOGLE_GENAI_API_KEY", "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_KEY"]) {
    vi.stubEnv(k, "");
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  hasHiggsfield.value = false;
});

describe("selectReelVideoProvider", () => {
  it("honors an explicit REEL_VIDEO_PROVIDER=higgsfield even if Veo has a key", async () => {
    vi.stubEnv("REEL_VIDEO_PROVIDER", "higgsfield");
    vi.stubEnv("GEMINI_API_KEY", "k");
    expect(await selectReelVideoProvider()).toBe("higgsfield");
  });

  it("honors an explicit REEL_VIDEO_PROVIDER=veo", async () => {
    vi.stubEnv("REEL_VIDEO_PROVIDER", "veo");
    clearVeo();
    hasHiggsfield.value = true;
    expect(await selectReelVideoProvider()).toBe("veo");
  });

  it("auto-selects Veo when it has a key (no explicit setting)", async () => {
    vi.stubEnv("REEL_VIDEO_PROVIDER", "");
    vi.stubEnv("GEMINI_API_KEY", "k");
    expect(await selectReelVideoProvider()).toBe("veo");
  });

  it("auto-falls to HIGGSFIELD when Veo has no key but Higgsfield is loaded (the operator's case)", async () => {
    vi.stubEnv("REEL_VIDEO_PROVIDER", "");
    clearVeo();
    hasHiggsfield.value = true;
    expect(await selectReelVideoProvider()).toBe("higgsfield");
  });

  it("defaults to veo when neither is configured (nothing to run, but predictable)", async () => {
    vi.stubEnv("REEL_VIDEO_PROVIDER", "");
    clearVeo();
    hasHiggsfield.value = false;
    expect(await selectReelVideoProvider()).toBe("veo");
  });

  it("honors an explicit REEL_VIDEO_PROVIDER=template_stock", async () => {
    vi.stubEnv("REEL_VIDEO_PROVIDER", "template_stock");
    vi.stubEnv("GEMINI_API_KEY", "k");
    expect(await selectReelVideoProvider()).toBe("template_stock");
  });

  it("NEVER auto-selects template_stock — it needs no credentials, so auto-detect would silently prefer it over a funded paid provider", async () => {
    vi.stubEnv("REEL_VIDEO_PROVIDER", "");
    clearVeo();
    hasHiggsfield.value = false;
    // The local lane can always run. That is exactly why it must not win by
    // default: the prod pin (higgsfield, a deliberate ~$1.30/reel decision)
    // and this default must both survive the lane existing.
    expect(await selectReelVideoProvider()).toBe("veo");

    hasHiggsfield.value = true;
    expect(await selectReelVideoProvider()).toBe("higgsfield");
  });
});

describe("reelClipCostUsd · the local lane is free", () => {
  it("bills template_stock at zero — it is a local ffmpeg render, no API call", async () => {
    const { reelClipCostUsd } = await import("./services/generationLedger");
    expect(reelClipCostUsd("template_stock")).toBe(0);
  });

  it("leaves the paid lanes priced as #1326 set them", async () => {
    const { reelClipCostUsd, COST_ESTIMATES_USD, VEO_DEFAULT_CLIP_SECONDS } = await import(
      "./services/generationLedger"
    );
    expect(reelClipCostUsd("higgsfield")).toBe(COST_ESTIMATES_USD.seedance_clip);
    // Veo bills per SECOND, so a flat per-clip constant cannot price it.
    expect(reelClipCostUsd("veo", {} as NodeJS.ProcessEnv)).toBeCloseTo(
      VEO_DEFAULT_CLIP_SECONDS * COST_ESTIMATES_USD.veo_second_720p,
      5,
    );
  });

  it("a 6-beat local reel reserves nothing against the daily generation budget", async () => {
    const { reelClipCostUsd } = await import("./services/generationLedger");
    // Billing it at the seedance rate would consume maxGenerationCostPerDayUsd
    // and start throwing BUDGET_DAILY_EXCEEDED for renders that cost nothing.
    expect(6 * reelClipCostUsd("template_stock")).toBe(0);
    expect(6 * reelClipCostUsd("higgsfield")).toBeGreaterThan(0);
  });
});
