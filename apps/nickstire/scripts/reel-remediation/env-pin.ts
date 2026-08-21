/**
 * Environment pins for the remediation scripts — as a SIDE-EFFECT MODULE,
 * because a top-level assignment in the entry file is too late.
 *
 * ES module imports are HOISTED: every `import` in a file is resolved and its
 * module body executed BEFORE any top-level statement of the importing file
 * runs. reelPipeline.ts captures its clip timeout in a module-level const:
 *
 *   const GEN_CLIP_TIMEOUT_MS = Number(process.env.REEL_GEN_CLIP_TIMEOUT_MS) || 6 * 60_000;
 *
 * so it reads the variable at IMPORT time. regen.ts assigned
 * process.env.REEL_GEN_CLIP_TIMEOUT_MS in its own top-level body, which runs
 * after that const is already frozen — the assignment had no effect at all.
 *
 * Measured 2026-08-21 with a probe mirroring the exact shapes:
 *   env at runtime         = 900000
 *   value frozen at import = 360000   <- the pin was INERT
 *
 * That matters beyond tidiness: the batch that "proved the timeout fix" was
 * actually running the ORIGINAL 6-minute ceiling the whole time. The real
 * cause of that batch succeeding was the concurrency drop (3 -> 1), which
 * removed the queue contention pushing beats over the limit. The timeout raise
 * had never once been in effect.
 *
 * Importing this module FIRST works because ESM evaluates a file's
 * dependencies in import order, so a side-effect-only module listed above the
 * pipeline import runs before the pipeline module body does.
 *
 * Env vars read INSIDE a function at call time (REEL_VIDEO_PROVIDER, via
 * selectReelVideoProvider) were never affected by this — only module-level
 * captures are.
 */

/**
 * Seedance clips measured 139-342s per beat, and three beats blew past the
 * 6-minute default under concurrency. 15 minutes leaves room for a genuinely
 * slow clip without leaving a hung CLI poll un-capped.
 */
if (!process.env.REEL_GEN_CLIP_TIMEOUT_MS) {
  process.env.REEL_GEN_CLIP_TIMEOUT_MS = String(15 * 60_000);
}

/**
 * Higgsfield is the provider this remediation exists to restore, and unlike
 * Veo it needs no S3_BUCKET (it returns its own durable CDN URL), which the
 * local environment does not have.
 */
if (!process.env.REEL_VIDEO_PROVIDER) {
  process.env.REEL_VIDEO_PROVIDER = "higgsfield";
}

export const REMEDIATION_ENV_PINNED = true;
