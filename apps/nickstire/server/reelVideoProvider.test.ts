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
});
