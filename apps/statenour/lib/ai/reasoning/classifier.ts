/**
 * lib/ai/reasoning/classifier.ts · Phase H (2026-05-18 PM) ·
 *                                   H.4 (2026-05-18 PM)
 *
 * Server-side classifier facade. The actual marker arrays + classify
 * logic live in classifier-core.ts (isomorphic · safe in browser).
 * This file used to duplicate the regex patterns; H.4 dedup moves
 * them to the core module so client (DeepModeNudge) + server share
 * one source of truth.
 *
 * Why keep this thin file at all? It's the stable import path used
 * by the engine + endpoints, and it lets us add server-only concerns
 * (logging, telemetry, persistence) without bloating the client
 * bundle.
 */

export {
  classifyCore as classifyReasoning,
  countSubQuestions,
  STANDARD_MARKERS,
  DEEP_MARKERS,
  THOROUGH_MARKERS,
  MEGA_MARKERS,
  QUICK_OVERRIDES,
} from "./classifier-core";

export type { CoreVerdict as ClassifierVerdict } from "./classifier-core";

// __markers kept for back-compat with any tests / dev introspection
// that imported the old shape from this module.
import {
  STANDARD_MARKERS as S,
  DEEP_MARKERS as D,
  THOROUGH_MARKERS as T,
  MEGA_MARKERS as M,
  QUICK_OVERRIDES as Q,
} from "./classifier-core";

export const __markers = {
  STANDARD_MARKERS: S,
  DEEP_MARKERS: D,
  THOROUGH_MARKERS: T,
  MEGA_MARKERS: M,
  QUICK_OVERRIDES: Q,
};
