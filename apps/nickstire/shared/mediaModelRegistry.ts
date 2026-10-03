/**
 * Media model registry — the self-hosted generation lane's capability + license
 * truth, kept as DATA so a new checkpoint is one entry, not a union edit across
 * ten files.
 *
 * PROVIDER vs PROFILE. `self_hosted` is ONE provider identity in reelPipeline
 * (beside veo / higgsfield / template_stock). Which open-weight model actually
 * renders is a PROFILE beneath it (`ltx-2.5-dfr`, `wan2.2-ti2v-5b`, ...). The
 * reel pipeline never branches on a profile; it hands the profile id to NOUR
 * Video Forge (apps/video-forge) and reads the profile's timing/cost/license
 * metadata from here.
 *
 * DOCTRINE REUSE. `costClass` uses the exact vocabulary of
 * @nour/ai-capabilities (LOCAL_FREE … METERED_PAID) — no second, incompatible
 * notion of cost. Nickstire does not depend on that package and has no lane
 * router consumer for media today, so the literals are mirrored rather than an
 * adapter shipped with nothing calling it.
 *
 * LICENSE GATE. Code license != weight license != output license. A profile is
 * production-eligible only when its license state is APPROVED_COMMERCIAL or
 * APPROVED_WITH_CONDITIONS *and* its rollout state allows it. UNKNOWN can never
 * become production by omission: `profileEligibility` is an allowlist.
 *
 * apps/video-forge/forge/profiles.json is the runtime copy the GPU worker
 * enforces; mediaModelRegistry.test.ts fails CI if the two disagree on ids,
 * license state or rollout state.
 */

export type MediaLicenseState =
  | "APPROVED_COMMERCIAL"
  | "APPROVED_WITH_CONDITIONS"
  | "RESEARCH_ONLY"
  | "TERRITORY_BLOCKED"
  | "UNKNOWN"
  | "REJECTED";

/** Rollout ladder (prompt §25). Only the last three may serve production reels. */
export type MediaRolloutState =
  | "built"
  | "canary"
  | "benchmarked"
  | "shadow"
  | "operator_selectable"
  | "limited_default"
  | "default";

/** Mirrors @nour/ai-capabilities COST_CLASSES. */
export type MediaCostClass = "LOCAL_FREE" | "SUBSCRIPTION_INCLUDED" | "FREE_TIER" | "EXISTING_INFRA" | "METERED_PAID";

export type MediaTier = "QUALITY" | "BALANCED" | "ECONOMY" | "TEST";

export interface MediaModelProfile {
  id: string;
  tier: MediaTier;
  family: string;
  /** Exact upstream checkpoint. "UNPINNED" until a canary records the hash. */
  checkpoint: string;
  checkpointSha256: string | "UNPINNED";
  source: string;
  capabilities: {
    textToVideo: boolean;
    imageToVideo: boolean;
    firstLastFrame: boolean;
    referenceImages: boolean;
    portrait9x16: boolean;
    maxWidth: number;
    maxHeight: number;
    durationsSeconds: readonly number[];
    fps: number;
    deterministicSeed: boolean;
    nativeAudio: boolean;
    retake: boolean;
    negativePrompt: boolean;
  };
  hardware: { minVramGb: number; recommendedVramGb: number; referenceGpu: string };
  /** Timing is PER PROFILE — a healthy 15-minute DFR render is not a dead 6-minute provider. */
  timing: {
    /** Typical wall-clock on the reference GPU (ESTIMATE until benchmarked). */
    expectedRenderMs: number;
    /** Past this age a still-"running" job is cancelled and treated as failed. No zombies. */
    hardCeilingMs: number;
    /** A running job whose worker heartbeat is older than this is presumed dead. */
    staleHeartbeatMs: number;
  };
  cost: {
    /** Expected GPU-seconds per clip on the reference GPU (ESTIMATE until benchmarked). */
    expectedGpuSeconds: number;
    /** Reference $/GPU-hour for the estimate; settle() uses the worker's measured seconds. */
    referenceUsdPerGpuHour: number;
  };
  license: {
    state: MediaLicenseState;
    upstreamLicense: string;
    conditions: string;
    territorialRestrictions: string;
    revenueThreshold: string;
    attribution: string;
    reviewedAt: string;
    evidence: readonly string[];
  };
  rollout: MediaRolloutState;
}

const PRODUCTION_ROLLOUT: ReadonlySet<MediaRolloutState> = new Set(["operator_selectable", "limited_default", "default"]);
const PRODUCTION_LICENSE: ReadonlySet<MediaLicenseState> = new Set(["APPROVED_COMMERCIAL", "APPROVED_WITH_CONDITIONS"]);

/** 720p-class portrait; both LTX and Wan require multiples of 32, hence 704 not 720. */
const PORTRAIT_720 = { maxWidth: 704, maxHeight: 1280 } as const;

export const MEDIA_MODEL_PROFILES: readonly MediaModelProfile[] = [
  {
    id: "ltx-2.5-dfr",
    tier: "QUALITY",
    family: "LTX-2.5 (Lightricks)",
    checkpoint: "Lightricks/LTX-2.5 (ltx-2.5-22b-dev-transformer-bf16 + DFR pipeline)",
    checkpointSha256: "UNPINNED",
    source: "https://huggingface.co/Lightricks/LTX-2.5",
    capabilities: {
      textToVideo: true, imageToVideo: true, firstLastFrame: true, referenceImages: false,
      portrait9x16: true, maxWidth: 1080, maxHeight: 1920, durationsSeconds: [4, 5, 6, 8], fps: 24,
      deterministicSeed: true, nativeAudio: true, retake: true, negativePrompt: true,
    },
    hardware: { minVramGb: 32, recommendedVramGb: 80, referenceGpu: "A100-80GB / H100-80GB" },
    // ESTIMATE (no DFR measurement found): distilled is documented 3-5x faster than dev;
    // ~27 s for distilled on a 5090 → dev/DFR multi-stage budgeted at ~6 min on 80GB.
    timing: { expectedRenderMs: 6 * 60_000, hardCeilingMs: 40 * 60_000, staleHeartbeatMs: 3 * 60_000 },
    cost: { expectedGpuSeconds: 360, referenceUsdPerGpuHour: 2.5 },
    license: {
      state: "APPROVED_WITH_CONDITIONS",
      upstreamLicense: "LTX-2 Community License (LICENSE-2_x)",
      conditions: "Free commercial use below the revenue threshold; separate prohibition on offering a competing generation service (Video Forge is private/internal — get written clearance before exposing it to anyone else); acceptable-use policy applies regardless; keep upstream provenance/watermark features enabled; disclose AI generation (reelDisclosure already does); no transfer of fine-tunes to >= $10M entities.",
      territorialRestrictions: "none recorded",
      revenueThreshold: "Entities with >= USD 10M annual revenue need a commercial agreement with Lightricks. ASSUMPTION: Nick's Tire is below it — operator must confirm.",
      attribution: "per LICENSE-2_x",
      reviewedAt: "2026-10-03",
      evidence: ["https://github.com/Lightricks/LTX-2/blob/main/LICENSE-2_x", "https://github.com/Lightricks/LTX-2"],
    },
    rollout: "built",
  },
  {
    id: "ltx-2.5-distilled",
    tier: "BALANCED",
    family: "LTX-2.5 (Lightricks)",
    checkpoint: "Lightricks/LTX-2.5 (ltx-2.5-22b-distilled-transformer-bf16, 8-step)",
    checkpointSha256: "UNPINNED",
    source: "https://github.com/Lightricks/LTX-2",
    capabilities: {
      textToVideo: true, imageToVideo: true, firstLastFrame: true, referenceImages: false,
      portrait9x16: true, maxWidth: 1080, maxHeight: 1920, durationsSeconds: [4, 5, 6, 8], fps: 24,
      deterministicSeed: true, nativeAudio: true, retake: false, negativePrompt: true,
    },
    hardware: { minVramGb: 24, recommendedVramGb: 80, referenceGpu: "A100-80GB / H100-80GB" },
    // Community-measured: 121 frames @1280x704 ≈ 27 s warm on one RTX 5090, +27 s on a
    // prompt change (encoder/transformer swap) — budget 2 min incl. load until benchmarked.
    timing: { expectedRenderMs: 2 * 60_000, hardCeilingMs: 15 * 60_000, staleHeartbeatMs: 2 * 60_000 },
    cost: { expectedGpuSeconds: 120, referenceUsdPerGpuHour: 2.5 },
    license: {
      state: "APPROVED_WITH_CONDITIONS",
      upstreamLicense: "LTX-2 Community License (LICENSE-2_x)",
      conditions: "Same as ltx-2.5-dfr.",
      territorialRestrictions: "none recorded",
      revenueThreshold: ">= USD 10M annual revenue requires a commercial agreement.",
      attribution: "per LICENSE-2_x",
      reviewedAt: "2026-10-03",
      evidence: ["https://github.com/Lightricks/LTX-2/blob/main/LICENSE-2_x"],
    },
    rollout: "built",
  },
  {
    id: "wan2.2-ti2v-5b",
    tier: "ECONOMY",
    family: "Wan 2.2 (Alibaba Wan-AI)",
    checkpoint: "Wan-AI/Wan2.2-TI2V-5B",
    checkpointSha256: "UNPINNED",
    source: "https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B",
    capabilities: {
      textToVideo: true, imageToVideo: true, firstLastFrame: false, referenceImages: false,
      portrait9x16: true, ...PORTRAIT_720, durationsSeconds: [4, 5], fps: 24,
      deterministicSeed: true, nativeAudio: false, retake: false, negativePrompt: true,
    },
    hardware: { minVramGb: 24, recommendedVramGb: 48, referenceGpu: "RTX 4090 24GB (upstream reference)" },
    // Upstream reports < 9 min for 5 s 720p on one consumer GPU, unoptimized.
    // Community-measured 667 s for 5 s 720p on a 4090 (50 steps).
    timing: { expectedRenderMs: 12 * 60_000, hardCeilingMs: 30 * 60_000, staleHeartbeatMs: 3 * 60_000 },
    cost: { expectedGpuSeconds: 667, referenceUsdPerGpuHour: 0.69 },
    license: {
      state: "APPROVED_COMMERCIAL",
      upstreamLicense: "Apache-2.0 (code and weights)",
      conditions: "Apache-2.0 notice retention.",
      territorialRestrictions: "none",
      revenueThreshold: "none",
      attribution: "Apache-2.0 NOTICE",
      reviewedAt: "2026-10-03",
      evidence: ["https://github.com/Wan-Video/Wan2.2", "https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B"],
    },
    rollout: "built",
  },
  {
    id: "minimax-h3",
    tier: "QUALITY",
    family: "MiniMax H3",
    checkpoint: "MiniMaxAI/MiniMax-H3",
    checkpointSha256: "UNPINNED",
    source: "https://huggingface.co/MiniMaxAI/MiniMax-H3",
    capabilities: {
      textToVideo: true, imageToVideo: true, firstLastFrame: false, referenceImages: false,
      portrait9x16: true, maxWidth: 1080, maxHeight: 1920, durationsSeconds: [6], fps: 24,
      deterministicSeed: true, nativeAudio: false, retake: false, negativePrompt: false,
    },
    hardware: { minVramGb: 80, recommendedVramGb: 80, referenceGpu: "H100-80GB" },
    timing: { expectedRenderMs: 15 * 60_000, hardCeilingMs: 45 * 60_000, staleHeartbeatMs: 3 * 60_000 },
    cost: { expectedGpuSeconds: 900, referenceUsdPerGpuHour: 2.5 },
    license: {
      state: "TERRITORY_BLOCKED",
      upstreamLicense: "MiniMax community license",
      conditions: "Separate authorization required for excluded territories.",
      territorialRestrictions: "United States listed as an excluded territory (model and outputs).",
      revenueThreshold: "n/a",
      attribution: "n/a",
      reviewedAt: "2026-10-03",
      evidence: ["https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE"],
    },
    rollout: "built",
  },
  {
    // CI / integration-test backend: ffmpeg test pattern. Never production.
    id: "mock-testpattern",
    tier: "TEST",
    family: "ffmpeg testsrc2",
    checkpoint: "none",
    checkpointSha256: "UNPINNED",
    source: "apps/video-forge/forge/backends/mock.py",
    capabilities: {
      textToVideo: true, imageToVideo: true, firstLastFrame: true, referenceImages: false,
      portrait9x16: true, ...PORTRAIT_720, durationsSeconds: [4, 5, 6, 8], fps: 24,
      deterministicSeed: true, nativeAudio: false, retake: false, negativePrompt: true,
    },
    hardware: { minVramGb: 0, recommendedVramGb: 0, referenceGpu: "CPU" },
    timing: { expectedRenderMs: 10_000, hardCeilingMs: 5 * 60_000, staleHeartbeatMs: 60_000 },
    cost: { expectedGpuSeconds: 0, referenceUsdPerGpuHour: 0 },
    license: {
      state: "UNKNOWN",
      upstreamLicense: "n/a — synthetic test pattern",
      conditions: "test only",
      territorialRestrictions: "n/a",
      revenueThreshold: "n/a",
      attribution: "n/a",
      reviewedAt: "2026-10-03",
      evidence: [],
    },
    rollout: "built",
  },
];

export function getMediaProfile(id: string | undefined | null): MediaModelProfile | undefined {
  if (!id) return undefined;
  return MEDIA_MODEL_PROFILES.find((p) => p.id === id);
}

export interface ProfileEligibility {
  eligible: boolean;
  reasons: string[];
}

/**
 * May this profile render a reel that can be PUBLISHED? Allowlist: license must
 * be approved AND rollout must have reached operator_selectable. Everything
 * else — including UNKNOWN — is refused with the reason named.
 *
 * `allowPreProduction` lets the canary/benchmark harness run built/canary
 * profiles; it never relaxes the license half.
 */
export function profileEligibility(
  profile: MediaModelProfile | undefined,
  opts: { allowPreProduction?: boolean } = {},
): ProfileEligibility {
  if (!profile) return { eligible: false, reasons: ["unknown_profile"] };
  const reasons: string[] = [];
  if (!PRODUCTION_LICENSE.has(profile.license.state)) reasons.push(`license_${profile.license.state.toLowerCase()}`);
  if (!opts.allowPreProduction && !PRODUCTION_ROLLOUT.has(profile.rollout)) reasons.push(`rollout_${profile.rollout}`);
  return { eligible: reasons.length === 0, reasons };
}


export interface ClipRequestShape {
  width: number;
  height: number;
  durationSeconds: number;
  startImage: boolean;
  endImage: boolean;
}

/** Capability mismatch is decided BEFORE a GPU is touched. */
export function capabilityMismatches(profile: MediaModelProfile, req: ClipRequestShape): string[] {
  const c = profile.capabilities;
  const out: string[] = [];
  if (req.height > req.width && !c.portrait9x16) out.push("portrait_unsupported");
  const longEdge = Math.max(req.width, req.height);
  const shortEdge = Math.min(req.width, req.height);
  if (longEdge > Math.max(c.maxWidth, c.maxHeight) || shortEdge > Math.min(c.maxWidth, c.maxHeight)) out.push("resolution_unsupported");
  if (!c.durationsSeconds.includes(req.durationSeconds)) out.push("duration_unsupported");
  if (req.startImage && !c.imageToVideo) out.push("image_to_video_unsupported");
  if (req.endImage && !c.firstLastFrame) out.push("first_last_frame_unsupported");
  return out;
}

/** Where the GPU that runs Video Forge comes from — decides cost semantics, not health. */
export type ComputeSource = "rented_gpu" | "owned_gpu" | "existing_infra";

export function computeSourceFromEnv(env: NodeJS.ProcessEnv = process.env): ComputeSource {
  const v = (env.VIDEO_FORGE_COMPUTE_SOURCE || "").toLowerCase();
  if (v === "owned_gpu" || v === "existing_infra") return v;
  return "rented_gpu"; // the conservative default: assume metered
}

export function costClassForComputeSource(src: ComputeSource): MediaCostClass {
  // Owned GPUs are NOT LOCAL_FREE: power, cooling and depreciation are real.
  // EXISTING_INFRA is the doctrine's word for "already paid for, marginal ~0".
  return src === "rented_gpu" ? "METERED_PAID" : "EXISTING_INFRA";
}
