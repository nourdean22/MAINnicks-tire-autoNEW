/**
 * Braintrust model wrap · Wave-200 Phase 1 (2026-05-17)
 *
 * Wraps an AI SDK v6 LanguageModel so every call gets logged to Braintrust
 * as a span — prompt · tools · output · latency · cost · all auto-captured.
 *
 * Defensive: if BRAINTRUST_API_KEY is missing or empty, returns the model
 * unchanged (no-op). This lets us ship the wrap into production WITHOUT
 * waiting for the operator to create a Braintrust account — when they
 * paste the key, traces start flowing automatically on the next deploy.
 *
 * Use:
 *   import { wrapWithBraintrust } from "@/lib/ai/braintrust-wrap";
 *   const model = wrapWithBraintrust(getModel("reason"));
 *
 * See: docs/adr/0002-braintrust-observability.md
 */

import type { LanguageModel } from "ai";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/braintrust-wrap");

const BRAINTRUST_API_KEY = (process.env.BRAINTRUST_API_KEY ?? "").trim();
const BRAINTRUST_PROJECT_NAME = (process.env.BRAINTRUST_PROJECT_NAME ?? "statenour-nick").trim();

let warnedMissing = false;

/**
 * Tracks whether the most recent wrap actually succeeded.
 *
 * 2026-05-17 follow-up · pre-fix, `isBraintrustActive()` returned
 * `true` purely based on the env var presence · any dashboard that
 * checked "tracing active" would say YES even when wrap silently
 * fell back to the unwrapped model (missing SDK · bad version ·
 * thrown error). Now we track the real outcome so downstream
 * consumers (health endpoint · /system surfaces) can show the truth.
 */
type WrapStatus = "active" | "failed" | "inactive";
let _wrapStatus: WrapStatus = "inactive";

/**
 * Wrap a model so it logs to Braintrust. No-op when key missing.
 *
 * The actual braintrust SDK import is dynamic so this module doesn't
 * crash if the package isn't installed (it is, as of Wave-200 Phase 0).
 * The wrap call is also dynamic so we never import unless we're going
 * to actually use it.
 */
export function wrapWithBraintrust(model: LanguageModel): LanguageModel {
  if (!BRAINTRUST_API_KEY) {
    _wrapStatus = "inactive";
    if (!warnedMissing) {
      log.info("braintrust_skipped", {
        reason: "BRAINTRUST_API_KEY unset",
        hint: "set the env var on Railway statenour-web to activate tracing",
      });
      warnedMissing = true;
    }
    return model;
  }
  try {
     
    const braintrust = require("braintrust") as {
      wrapAISDKModel?: (m: LanguageModel) => LanguageModel;
      initLogger?: (opts: { projectName: string; apiKey: string }) => void;
    };
    braintrust.initLogger?.({
      projectName: BRAINTRUST_PROJECT_NAME,
      apiKey: BRAINTRUST_API_KEY,
    });
    if (typeof braintrust.wrapAISDKModel === "function") {
      _wrapStatus = "active";
      return braintrust.wrapAISDKModel(model);
    }
    _wrapStatus = "failed";
    log.warn("braintrust_wrap_unavailable", {
      reason: "wrapAISDKModel export not found · check braintrust SDK version",
    });
    return model;
  } catch (err) {
    _wrapStatus = "failed";
    log.warn("braintrust_wrap_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return model;
  }
}

/**
 * Whether Braintrust tracing is actually flowing. Reflects the most
 * recent wrap outcome · NOT just env-var presence. Use this from
 * health endpoints + /system surfaces to show the operator-visible
 * truth instead of an optimistic green light.
 */
export function isBraintrustActive(): boolean {
  return _wrapStatus === "active";
}

/** Detailed wrap status for diagnostics. */
export function braintrustWrapStatus(): WrapStatus {
  return _wrapStatus;
}
