/**
 * Ollama Cloud lane routing · doctrine tests (2026-08-06).
 *
 * The trap this pins: ~9 call sites hard-pin "gpt-4o-mini", which Ollama
 * Cloud does not host — an env-only base-URL switch would 404 every pin.
 * AI_FORCE_OLLAMA=true must therefore reroute EVERY request (gpt-*, o*,
 * gemini-* included) onto the funded lane, and substring detection must
 * route ollama-family models even without the flag.
 *
 * Env hygiene per AGENTS §3: singleFork shares one process.env — every var
 * this file touches is restored-or-deleted in afterEach.
 */
import { afterEach, describe, expect, it } from "vitest";
import { isOllamaModel, resolveEffectiveModel } from "./llm";

const TOUCHED = ["AI_FORCE_OLLAMA", "AI_FORCE_GEMINI", "OLLAMA_MODEL", "LLM_MODEL"] as const;
const orig: Record<string, string | undefined> = {};
for (const k of TOUCHED) orig[k] = process.env[k];

afterEach(() => {
  for (const k of TOUCHED) {
    if (orig[k] === undefined) delete process.env[k];
    else process.env[k] = orig[k];
  }
});

describe("AI_FORCE_OLLAMA rerouting", () => {
  it("reroutes gpt pins, o* pins, gemini pins, and undefined onto the ollama default", () => {
    process.env.AI_FORCE_OLLAMA = "true";
    delete process.env.OLLAMA_MODEL;
    delete process.env.LLM_MODEL;
    for (const requested of ["gpt-4o-mini", "o3-mini", "gemini-2.5-flash", undefined]) {
      expect(resolveEffectiveModel(requested)).toBe("deepseek-v4-pro");
    }
  });

  it("OLLAMA_MODEL overrides the default under the flag", () => {
    process.env.AI_FORCE_OLLAMA = "true";
    process.env.OLLAMA_MODEL = "qwen3-coder:480b";
    expect(resolveEffectiveModel("gpt-4o-mini")).toBe("qwen3-coder:480b");
  });

  it("LLM_MODEL (OpenRouter-era var) must NOT leak through the flag — live probe 404'd on exactly this", () => {
    process.env.AI_FORCE_OLLAMA = "true";
    delete process.env.OLLAMA_MODEL;
    process.env.LLM_MODEL = "meta-llama/llama-3.3-70b-instruct";
    expect(resolveEffectiveModel(undefined)).toBe("deepseek-v4-pro");
  });

  it("flag off → passthrough untouched (existing behavior preserved)", () => {
    delete process.env.AI_FORCE_OLLAMA;
    delete process.env.AI_FORCE_GEMINI;
    expect(resolveEffectiveModel("gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(resolveEffectiveModel(undefined)).toBeUndefined();
  });

  it("ollama takes precedence over AI_FORCE_GEMINI when both are set", () => {
    process.env.AI_FORCE_OLLAMA = "true";
    process.env.AI_FORCE_GEMINI = "true";
    delete process.env.OLLAMA_MODEL;
    delete process.env.LLM_MODEL;
    expect(resolveEffectiveModel("gpt-4o-mini")).toBe("deepseek-v4-pro");
  });
});

describe("isOllamaModel substring detection (no flag)", () => {
  it("routes ollama-family ids and rejects others", () => {
    delete process.env.AI_FORCE_OLLAMA;
    for (const m of ["deepseek-v4-pro", "qwen3-coder:480b", "gpt-oss:120b", "glm-5.2", "kimi-k2"]) {
      expect(isOllamaModel(m)).toBe(true);
    }
    for (const m of ["gpt-4o-mini", "gemini-2.5-flash", undefined]) {
      expect(isOllamaModel(m)).toBe(false);
    }
  });
});
