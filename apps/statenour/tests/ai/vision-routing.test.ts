/**
 * tests/ai/vision-routing.test.ts — image-chat routing (2026-07-29).
 *
 * Regression for a REPORTED production failure: the operator
 * photographed a book, asked Nick to act on it, and got a bare
 * "Stream failed." with FALLBACK ACTIVE in the header.
 *
 * Root cause: vision was modeled for ONE provider. resolveProviderModel
 * had an ollama-only branch, so every other provider ignored taskType
 * "vision" and returned its default CHAT model — and nothing checked
 * capability. When the ollama vision lane was unavailable (this config
 * records that lane dying twice: qwen3-vl retired 2026-06-16, "every
 * image chat turn hit a dead model and silently did nothing"), fallback
 * handed the image to a text model, which rejected the image part.
 *
 * These tests pin the two invariants that make that impossible:
 *   1. every provider that declares a vision model resolves it, and
 *   2. a provider that declares none can never serve an image turn.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PROVIDERS_REGISTRY } from "@/config/ai-providers";
import { resolveProviderModel, isVisionCapableProvider } from "@/lib/ai/provider";

const VISION_ENV_KEYS = Object.values(PROVIDERS_REGISTRY)
  .map((cfg) => cfg.visionModelEnv)
  .filter((k): k is string => Boolean(k));

/**
 * 2026-08-01 · These cases assert the REGISTRY DEFAULT resolves. That is
 * only true when no operator override is set — and `resolveProviderModel`
 * is documented to prefer `visionModelEnv` when it is.
 *
 * Ambient env reaches this suite: importing anything that transitively
 * pulls `@/lib/prisma` runs `loadEnvConfig(process.cwd())` at module load
 * (lib/prisma.ts), which loads the operator's untracked `.env` into
 * process.env. So a developer with `OLLAMA_VISION_MODEL` set saw these
 * fail while CI — which has no `.env` — stayed green. Clearing the
 * override keys makes the default contract testable regardless of the
 * machine; the override contract gets its own case below.
 */
beforeEach(() => {
  for (const key of VISION_ENV_KEYS) vi.stubEnv(key, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("vision model resolution (all providers, not just ollama)", () => {
  it("every provider declaring a vision model resolves it for taskType vision", () => {
    const declaring = (
      Object.keys(PROVIDERS_REGISTRY) as Array<keyof typeof PROVIDERS_REGISTRY>
    ).filter((p) => PROVIDERS_REGISTRY[p].defaultVisionModel);
    // ollama alone was the pre-fix behavior; the fix is that others join it.
    expect(declaring.length).toBeGreaterThan(1);
    for (const p of declaring) {
      expect(resolveProviderModel(p, "vision"), `${p} vision model`).toBe(
        PROVIDERS_REGISTRY[p].defaultVisionModel,
      );
    }
  });

  it("a vision turn does NOT silently fall back to the provider's chat model", () => {
    // The exact pre-fix defect: taskType "vision" returning defaultModel.
    for (const p of ["ollama", "gemini", "openai", "anthropic"] as const) {
      const cfg = PROVIDERS_REGISTRY[p];
      if (!cfg.defaultVisionModel) continue;
      const resolved = resolveProviderModel(p, "vision");
      if (cfg.defaultVisionModel !== cfg.defaultModel) {
        expect(resolved, `${p} must not return its chat model`).not.toBe(cfg.defaultModel);
      }
      expect(resolved).toBeTruthy();
    }
  });

  it("ollama still resolves its dedicated vision model (no regression)", () => {
    expect(resolveProviderModel("ollama", "vision")).toBe(
      PROVIDERS_REGISTRY.ollama.defaultVisionModel,
    );
    // ...and it is NOT the text chat default that broke image turns.
    expect(resolveProviderModel("ollama", "vision")).not.toBe(
      PROVIDERS_REGISTRY.ollama.defaultModel,
    );
  });

  it("an operator override wins over the registry default", () => {
    // The other half of the contract, previously untested — and the
    // reason the default cases must clear the env first. A pinned
    // override is legitimate (the registry comment invites it), so it
    // must NOT be treated as a regression.
    vi.stubEnv("OLLAMA_VISION_MODEL", "minimax-m3");
    expect(resolveProviderModel("ollama", "vision")).toBe("minimax-m3");
  });

  it("a blank or whitespace override falls back to the registry default", () => {
    // Fail-safe: an empty env var must not resolve to "" and hand the
    // provider an unnamed model.
    vi.stubEnv("OLLAMA_VISION_MODEL", "   ");
    expect(resolveProviderModel("ollama", "vision")).toBe(
      PROVIDERS_REGISTRY.ollama.defaultVisionModel,
    );
  });

  it("the retired qwen3-vl model is not the default on any lane", () => {
    // Regression pin for 2026-08-01: qwen3-vl:235b-instruct was RETIRED
    // on Ollama Cloud 2026-06-16 (410) but survived as a hardcoded
    // literal in vision-input.ts and photo-improver.ts for weeks after
    // the registry was corrected. Nothing may default to it again.
    for (const cfg of Object.values(PROVIDERS_REGISTRY)) {
      expect(cfg.defaultVisionModel).not.toBe("qwen3-vl:235b-instruct");
    }
  });

  it("non-vision task types are untouched by the change", () => {
    expect(resolveProviderModel("gemini", "reason")).toBe(PROVIDERS_REGISTRY.gemini.defaultModel);
    expect(resolveProviderModel("anthropic", "reason")).toBe(
      PROVIDERS_REGISTRY.anthropic.defaultModel,
    );
  });
});

describe("vision capability gate (fail closed)", () => {
  it("declared providers are vision-capable", () => {
    expect(isVisionCapableProvider("ollama")).toBe(true);
    expect(isVisionCapableProvider("gemini")).toBe(true);
    expect(isVisionCapableProvider("openai")).toBe(true);
    expect(isVisionCapableProvider("anthropic")).toBe(true);
  });

  it("openrouter is EXCLUDED until explicitly opted in", () => {
    // Its configured id is an uncensored chat model of unknown image
    // support. Guessing is how an image reaches a model that rejects it.
    expect(PROVIDERS_REGISTRY.openrouter.defaultVisionModel).toBeUndefined();
    expect(isVisionCapableProvider("openrouter")).toBe(false);
  });

  it("the emergency stub lane can never serve an image turn", () => {
    // It would answer ABOUT an image it never saw — worse than failing.
    expect(isVisionCapableProvider("emergency")).toBe(false);
  });
});

// ── The other half of the reported bug: the operator saw a bare
// "Stream failed." with no reason, so a vision-lane outage was
// indistinguishable from a network blip.
import {
  categorizeStreamError,
  CLIENT_SAFE_STREAM_ERROR_TEXT,
} from "@/lib/services/chat/stream-error-handler";

describe("stream error is categorized, never echoed", () => {
  it("an image/vision failure says so — the case that was reported", () => {
    const msg = categorizeStreamError(new Error("model does not support image input"));
    expect(msg).toMatch(/image/i);
    expect(msg).not.toBe(CLIENT_SAFE_STREAM_ERROR_TEXT);
  });

  it("quota, timeout and context-length each get their own actionable text", () => {
    expect(categorizeStreamError(new Error("429 rate limit exceeded"))).toMatch(/quota|rate/i);
    expect(categorizeStreamError(new Error("ETIMEDOUT"))).toMatch(/too long|Retry/i);
    expect(categorizeStreamError(new Error("maximum context length exceeded"))).toMatch(
      /context window/i,
    );
  });

  it("an unrecognized error falls back to the neutral constant", () => {
    expect(categorizeStreamError(new Error("socket hang up"))).toBe(
      CLIENT_SAFE_STREAM_ERROR_TEXT,
    );
    expect(categorizeStreamError(null)).toBe(CLIENT_SAFE_STREAM_ERROR_TEXT);
  });

  it("NEVER echoes raw provider text — the no-echo policy still holds", () => {
    const leaky = new Error("401 invalid api key sk-proj-SECRET123 for image model");
    const out = categorizeStreamError(leaky);
    expect(out).not.toContain("sk-proj-SECRET123");
    expect(out).not.toContain("401");
  });
});
