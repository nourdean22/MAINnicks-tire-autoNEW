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
 * Wrap a model so it logs to Braintrust. No-op when key missing.
 *
 * The actual braintrust SDK import is dynamic so this module doesn't
 * crash if the package isn't installed (it is, as of Wave-200 Phase 0).
 * The wrap call is also dynamic so we never import unless we're going
 * to actually use it.
 */
export function wrapWithBraintrust(model: LanguageModel): LanguageModel {
  if (!BRAINTRUST_API_KEY) {
    if (!warnedMissing) {
      log.info("braintrust_skipped", {
        reason: "BRAINTRUST_API_KEY unset",
        hint: "set the env var on Railway statenour-web to activate tracing",
      });
      warnedMissing = true;
    }
    return model;
  }
  // Dynamic require keeps the cold path off the boot-time import chain.
  // braintrust.wrapAISDKModel takes any AI SDK v6 model and returns a
  // logged proxy with the same interface.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const braintrust = require("braintrust") as {
      wrapAISDKModel?: (m: LanguageModel) => LanguageModel;
      initLogger?: (opts: { projectName: string; apiKey: string }) => void;
    };
    braintrust.initLogger?.({
      projectName: BRAINTRUST_PROJECT_NAME,
      apiKey: BRAINTRUST_API_KEY,
    });
    if (typeof braintrust.wrapAISDKModel === "function") {
      return braintrust.wrapAISDKModel(model);
    }
    log.warn("braintrust_wrap_unavailable", {
      reason: "wrapAISDKModel export not found · check braintrust SDK version",
    });
    return model;
  } catch (err) {
    log.warn("braintrust_wrap_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return model;
  }
}

/** Whether Braintrust tracing is currently active. */
export function isBraintrustActive(): boolean {
  return BRAINTRUST_API_KEY.length > 0;
}
