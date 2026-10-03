/**
 * Self-hosted lane: license gate, registry ↔ worker parity, cost POLICY vs cost
 * AMOUNT, provider selection, and the prompt compiler.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MEDIA_MODEL_PROFILES,
  capabilityMismatches,
  getMediaProfile,
  profileEligibility,
} from "../shared/mediaModelRegistry";
import { compileForgePrompt } from "../shared/forgePromptAdapter";
import { buildStructuredVideoPrompt } from "../shared/reelVideoPrompt";

vi.mock("./services/higgsfieldStudio", () => ({ getHiggsfieldCredentialsJson: async () => '{"key":"x"}' }));

afterEach(() => vi.unstubAllEnvs());

describe("license gate", () => {
  it("UNKNOWN never becomes production-eligible, even with pre-production allowed", () => {
    const mock = getMediaProfile("mock-testpattern")!;
    expect(mock.license.state).toBe("UNKNOWN");
    expect(profileEligibility(mock, { allowPreProduction: true }).eligible).toBe(false);
  });
  it("MiniMax H3 is TERRITORY_BLOCKED for a US shop", () => {
    const h3 = getMediaProfile("minimax-h3")!;
    expect(h3.license.state).toBe("TERRITORY_BLOCKED");
    expect(profileEligibility(h3, { allowPreProduction: true }).reasons).toContain("license_territory_blocked");
  });
  it("nothing is production-eligible until it clears the rollout ladder (no benchmark yet)", () => {
    for (const p of MEDIA_MODEL_PROFILES) expect(profileEligibility(p).eligible).toBe(false);
  });
  it("approved profiles become canary-eligible with the pre-production flag", () => {
    expect(profileEligibility(getMediaProfile("ltx-2.5-distilled"), { allowPreProduction: true }).eligible).toBe(true);
    expect(profileEligibility(getMediaProfile("wan2.2-ti2v-5b"), { allowPreProduction: true }).eligible).toBe(true);
  });
  it("every profile carries license evidence or is explicitly not approved", () => {
    for (const p of MEDIA_MODEL_PROFILES) {
      if (p.license.state.startsWith("APPROVED")) expect(p.license.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe("registry ↔ apps/video-forge/forge/profiles.json parity", () => {
  const worker = JSON.parse(
    readFileSync(path.join(__dirname, "..", "..", "video-forge", "forge", "profiles.json"), "utf8"),
  ).profiles as Record<string, { license_state: string; rollout: string; durations: number[] }>;
  it("same ids", () => {
    expect(Object.keys(worker).sort()).toEqual(MEDIA_MODEL_PROFILES.map((p) => p.id).sort());
  });
  it("same native shape (size + fps) — a mismatch fails worker output validation", () => {
    const w = worker as unknown as Record<string, { native: { width: number; height: number; fps: number } }>;
    for (const p of MEDIA_MODEL_PROFILES) {
      expect(w[p.id].native, p.id).toEqual({ width: p.native.width, height: p.native.height, fps: p.native.fps });
      expect(p.native.fps, p.id).toBe(p.capabilities.fps);
      expect(p.capabilities.durationsSeconds, p.id).toContain(p.native.durationSeconds);
    }
  });
  it("same license state, rollout state and durations", () => {
    for (const p of MEDIA_MODEL_PROFILES) {
      expect(worker[p.id].license_state, p.id).toBe(p.license.state);
      expect(worker[p.id].rollout, p.id).toBe(p.rollout);
      expect(worker[p.id].durations, p.id).toEqual([...p.capabilities.durationsSeconds]);
    }
  });
});

describe("capability mismatch is decided before a GPU is touched", () => {
  it("an image-to-video-only QUALITY candidate refuses a text-only request", () => {
    const a14b = getMediaProfile("wan2.2-i2v-a14b")!;
    expect(a14b.license.state).toBe("APPROVED_COMMERCIAL");
    expect(capabilityMismatches(a14b, { width: 720, height: 1280, durationSeconds: 5, startImage: false, endImage: false })).toEqual(["text_to_video_unsupported"]);
    expect(capabilityMismatches(a14b, { width: 720, height: 1280, durationSeconds: 5, startImage: true, endImage: false })).toEqual([]);
    expect(a14b.native).toEqual({ width: 720, height: 1280, fps: 16, durationSeconds: 5 });
  });
  it("Wan has no first+last frame and no 1080p", () => {
    const wan = getMediaProfile("wan2.2-ti2v-5b")!;
    expect(capabilityMismatches(wan, { width: 704, height: 1280, durationSeconds: 5, startImage: true, endImage: true })).toEqual(["first_last_frame_unsupported"]);
    expect(capabilityMismatches(wan, { width: 1080, height: 1920, durationSeconds: 5, startImage: false, endImage: false })).toContain("resolution_unsupported");
    expect(capabilityMismatches(wan, { width: 704, height: 1280, durationSeconds: 8, startImage: false, endImage: false })).toContain("duration_unsupported");
  });
});

describe("cost policy is separate from cost amount", () => {
  it("rented GPU: real cost, approval required unless the pool is pre-authorized", async () => {
    const { reelClipCostPolicy, reelClipCostUsd } = await import("./services/generationLedger");
    const env = { VIDEO_FORGE_PROFILE: "ltx-2.5-distilled" } as NodeJS.ProcessEnv;
    expect(reelClipCostUsd("self_hosted", env)).toBeGreaterThan(0);
    expect(reelClipCostUsd("self_hosted", env)).not.toBe(reelClipCostUsd("higgsfield", env)); // not priced as Seedance
    expect(reelClipCostPolicy("self_hosted", env)).toMatchObject({ costClass: "METERED_PAID", vendorApiCostUsd: 0, requiresSpendApproval: true });
    const pre = { ...env, VIDEO_FORGE_POOL_PREAUTHORIZED: "true" } as NodeJS.ProcessEnv;
    const p = reelClipCostPolicy("self_hosted", pre);
    expect(p.requiresSpendApproval).toBe(false);
    expect(p.estimatedComputeCostUsd).toBeGreaterThan(0); // pre-authorized is NOT free
  });
  it("owned GPU: EXISTING_INFRA, no per-repair approval, marginal rate is the operator's (power)", async () => {
    const { reelClipCostPolicy, reelClipCostUsd } = await import("./services/generationLedger");
    const env = { VIDEO_FORGE_COMPUTE_SOURCE: "owned_gpu", VIDEO_FORGE_MARGINAL_USD_PER_GPU_HOUR: "0.12" } as NodeJS.ProcessEnv;
    expect(reelClipCostPolicy("self_hosted", env)).toMatchObject({ costClass: "EXISTING_INFRA", requiresSpendApproval: false });
    expect(reelClipCostUsd("self_hosted", env)).toBeCloseTo((120 / 3600) * 0.12, 6);
  });
  it("paid vendors still require approval; template_stock never does", async () => {
    const { reelClipCostPolicy } = await import("./services/generationLedger");
    expect(reelClipCostPolicy("higgsfield").requiresSpendApproval).toBe(true);
    expect(reelClipCostPolicy("veo").requiresSpendApproval).toBe(true);
    expect(reelClipCostPolicy("template_stock")).toMatchObject({ requiresSpendApproval: false, costClass: "LOCAL_FREE" });
  });
  it("an unknown profile is priced conservatively, never at zero", async () => {
    const { reelClipCostUsd, COST_ESTIMATES_USD } = await import("./services/generationLedger");
    expect(reelClipCostUsd("self_hosted", { VIDEO_FORGE_PROFILE: "nope" } as NodeJS.ProcessEnv)).toBe(COST_ESTIMATES_USD.seedance_clip);
  });
});

describe("provider selection", () => {
  it("honors an explicit REEL_VIDEO_PROVIDER=self_hosted pin", async () => {
    vi.stubEnv("REEL_VIDEO_PROVIDER", "self_hosted");
    const { selectReelVideoProvider } = await import("./services/reelPipeline");
    expect(await selectReelVideoProvider()).toBe("self_hosted");
  });
  it("never auto-selects self_hosted, even when Video Forge is configured", async () => {
    vi.stubEnv("REEL_VIDEO_PROVIDER", "");
    vi.stubEnv("VIDEO_FORGE_URL", "https://forge");
    vi.stubEnv("VIDEO_FORGE_SECRET", "s");
    const { selectReelVideoProvider } = await import("./services/reelPipeline");
    expect(await selectReelVideoProvider()).not.toBe("self_hosted");
  });
  it("credential presence for self_hosted = URL + secret configured", async () => {
    const { reelProviderCredentialsPresent } = await import("./services/reelPipeline");
    vi.stubEnv("VIDEO_FORGE_URL", "");
    expect(await reelProviderCredentialsPresent("self_hosted")).toBe(false);
    vi.stubEnv("VIDEO_FORGE_URL", "https://forge");
    vi.stubEnv("VIDEO_FORGE_SECRET", "s");
    expect(await reelProviderCredentialsPresent("self_hosted")).toBe(true);
  });
  it("records the model profile in the ledger model column", async () => {
    vi.stubEnv("VIDEO_FORGE_PROFILE", "wan2.2-ti2v-5b");
    const { reelLedgerModel } = await import("./services/reelPipeline");
    expect(reelLedgerModel("self_hosted")).toBe("video_forge:wan2.2-ti2v-5b");
  });
});

describe("prompt compiler never mutates the canonical spec", () => {
  const spec = buildStructuredVideoPrompt(
    { visual: "a worn tire tread on a lift", motion: "slow dolly in to the tread blocks", audioCue: "air wrench in the distance" },
    { motionLens: "macro 100mm, shallow depth of field", archetype: "warm practical shop light", objectCharacter: "Tread the tire" },
  );
  it("LTX gets one chronological paragraph, with audio only when native audio exists", () => {
    const out = compileForgePrompt(spec, "ltx_prose", { nativeAudio: true });
    expect(out).not.toMatch(/^SUBJECT:/m);
    expect(out).toContain("Tread the tire.");
    expect(out).toContain("slow dolly in to the tread blocks.");
    expect(out).toContain("Sound: air wrench");
    expect(compileForgePrompt(spec, "ltx_prose", { nativeAudio: false })).not.toContain("Sound:");
  });
  it("Wan keeps labelled blocks but drops AUDIO (no audio track)", () => {
    const out = compileForgePrompt(spec, "wan_labelled");
    expect(out).toMatch(/^SUBJECT: Tread the tire/m);
    expect(out).not.toMatch(/^AUDIO:/m);
  });
  it("authored prose passes through untouched", () => {
    const authored = "A mechanic spins a wheel on the balancer, close-up.";
    expect(compileForgePrompt(authored, "ltx_prose")).toBe(authored);
  });
});
