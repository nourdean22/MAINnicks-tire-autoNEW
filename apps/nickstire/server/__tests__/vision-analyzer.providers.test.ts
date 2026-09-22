/**
 * vision-analyzer · the Gemini and Ollama providers (2026-09-22)
 *
 * WHY. photo_assess_enabled was flipped ON on 2026-09-22 with the default
 * provider (replicate) and no REPLICATE_API_KEY, so every customer photo
 * returned no_provider. The service already holds GEMINI_API_KEY (free tier)
 * and OLLAMA_API_KEY (the funded cloud lane); both speak the OpenAI
 * chat-completions shape with an inlined image. These tests pin the request
 * the analyzer sends and the three ways it fails closed. No network: fetch is
 * stubbed; the feature flag is mocked ON.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/featureFlags", () => ({ isEnabled: async () => true }));

import { analyzePhoto, checkVisionHealth } from "../services/vision-analyzer";

const PHOTO = "https://example.com/tire.jpg";
const ENV_KEYS = ["PHOTO_ASSESS_PROVIDER", "GEMINI_API_KEY", "OLLAMA_API_KEY", "OLLAMA_BASE_URL", "REPLICATE_API_KEY", "HF_API_KEY", "PHOTO_ASSESS_GEMINI_MODEL", "PHOTO_ASSESS_OLLAMA_MODEL"] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

type Call = { url: string; init?: RequestInit };
const calls: Call[] = [];

function imageResponse(): Response {
  return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200, headers: { "content-type": "image/png; charset=binary" } });
}

function stubFetch(completion: () => Response) {
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url) === PHOTO) return imageResponse();
    return completion();
  });
}

beforeEach(() => {
  calls.length = 0;
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("analyzePhoto · gemini", () => {
  it("posts the prompt and the photo, inlined as a data URL, to Gemini's OpenAI endpoint with the key as a bearer", async () => {
    process.env.GEMINI_API_KEY = "gk-test";
    stubFetch(() => Response.json({ model: "gemini-2.5-flash", choices: [{ message: { content: "Worn outer edge on a 225/65R17. SERVICE_SUGGEST: tire-replacement. URGENCY: soon." } }] }));

    const r = await analyzePhoto({ photoUrl: PHOTO, provider: "gemini" });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("gemini");
    expect(r.modelName).toBe("gemini-2.5-flash");
    expect(r.serviceSuggest).toBe("tire-replacement");
    expect(r.urgency).toBe("soon");

    expect(calls.map((c) => c.url)).toEqual([PHOTO, "https://generativelanguage.googleapis.com/v1beta/openai/v1/chat/completions"]);
    const headers = calls[1].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer gk-test");
    const body = JSON.parse(String(calls[1].init?.body));
    expect(body.model).toBe("gemini-2.5-flash");
    const parts = body.messages[0].content;
    expect(parts[0]).toEqual({ type: "text", text: expect.stringContaining("SERVICE_SUGGEST") });
    expect(parts[1].type).toBe("image_url");
    expect(parts[1].image_url.url).toBe("data:image/png;base64,AQID"); // bytes 1,2,3; the charset parameter is dropped
  });

  it("reads an array-shaped message content (some OpenAI-compatible servers return parts)", async () => {
    process.env.GEMINI_API_KEY = "gk-test";
    stubFetch(() => Response.json({ choices: [{ message: { content: [{ type: "text", text: "Sidewall bulge. " }, { type: "text", text: "SERVICE_SUGGEST: tire-replacement. URGENCY: immediate." }] } }] }));
    const r = await analyzePhoto({ photoUrl: PHOTO, provider: "gemini" });
    expect(r.ok && r.urgency).toBe("immediate");
  });

  it("fails closed as no_provider, naming the variable, when GEMINI_API_KEY is unset — and never fetches", async () => {
    stubFetch(() => Response.json({}));
    const r = await analyzePhoto({ photoUrl: PHOTO, provider: "gemini" });
    expect(r).toEqual({ ok: false, error: "GEMINI_API_KEY not set", reason: "no_provider" });
    expect(calls).toHaveLength(0);
  });

  it("a non-2xx from the provider is http_error with the status and the body's head", async () => {
    process.env.GEMINI_API_KEY = "gk-test";
    stubFetch(() => new Response('{"error":{"message":"quota"}}', { status: 429 }));
    const r = await analyzePhoto({ photoUrl: PHOTO, provider: "gemini" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("http_error");
    expect(r.error).toBe('gemini 429: {"error":{"message":"quota"}}');
  });

  it("an empty completion is parse_error, not a blank description", async () => {
    process.env.GEMINI_API_KEY = "gk-test";
    stubFetch(() => Response.json({ choices: [{ message: { content: "" } }] }));
    const r = await analyzePhoto({ photoUrl: PHOTO, provider: "gemini" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("parse_error");
  });
});

describe("analyzePhoto · ollama cloud", () => {
  it("uses OLLAMA_API_KEY against OLLAMA_BASE_URL (default ollama.com) and the vision model pin", async () => {
    process.env.OLLAMA_API_KEY = "ok-test";
    process.env.PHOTO_ASSESS_OLLAMA_MODEL = "qwen3.5:397b";
    stubFetch(() => Response.json({ model: "qwen3.5:397b", choices: [{ message: { content: "Tread at the wear bars. SERVICE_SUGGEST: tire-replacement. URGENCY: soon." } }] }));
    const r = await analyzePhoto({ photoUrl: PHOTO, provider: "ollama" });
    expect(r.ok && r.source).toBe("ollama");
    expect(calls[1].url).toBe("https://ollama.com/v1/chat/completions");
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe("Bearer ok-test");
    expect(JSON.parse(String(calls[1].init?.body)).model).toBe("qwen3.5:397b");
  });

  it("defaults the model to gemma4:31b and fails closed without the key", async () => {
    stubFetch(() => Response.json({}));
    expect(await analyzePhoto({ photoUrl: PHOTO, provider: "ollama" })).toEqual({ ok: false, error: "OLLAMA_API_KEY not set", reason: "no_provider" });
    process.env.OLLAMA_API_KEY = "ok-test";
    stubFetch(() => Response.json({ choices: [{ message: { content: "ok. SERVICE_SUGGEST: unclear. URGENCY: unclear." } }] }));
    await analyzePhoto({ photoUrl: PHOTO, provider: "ollama" });
    expect(JSON.parse(String(calls[calls.length - 1].init?.body)).model).toBe("gemma4:31b");
  });
});

describe("PHOTO_ASSESS_PROVIDER", () => {
  it("routes by the env var, and an unknown value is reported instead of silently becoming replicate", async () => {
    process.env.PHOTO_ASSESS_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "gk-test";
    stubFetch(() => Response.json({ choices: [{ message: { content: "fine. SERVICE_SUGGEST: unclear. URGENCY: unclear." } }] }));
    const viaEnv = await analyzePhoto({ photoUrl: PHOTO });
    expect(viaEnv.ok && viaEnv.source).toBe("gemini");

    process.env.PHOTO_ASSESS_PROVIDER = "gemeni";
    const typo = await analyzePhoto({ photoUrl: PHOTO });
    expect(typo).toEqual({ ok: false, error: "PHOTO_ASSESS_PROVIDER=gemeni is not one of replicate|hf|gemini|ollama", reason: "no_provider" });
  });
});

describe("checkVisionHealth", () => {
  it("reports reachability by the configured provider's own key variable", async () => {
    process.env.PHOTO_ASSESS_PROVIDER = "ollama";
    expect(await checkVisionHealth()).toEqual({ enabled: true, provider: "ollama", providerReachable: false, error: "OLLAMA_API_KEY not set" });
    process.env.OLLAMA_API_KEY = "ok-test";
    expect(await checkVisionHealth()).toEqual({ enabled: true, provider: "ollama", providerReachable: true, error: undefined });
    process.env.PHOTO_ASSESS_PROVIDER = "gemini";
    expect((await checkVisionHealth()).error).toBe("GEMINI_API_KEY not set");
    process.env.PHOTO_ASSESS_PROVIDER = "nope";
    expect(await checkVisionHealth()).toMatchObject({ provider: "nope", providerReachable: false, error: expect.stringContaining("not one of") });
  });
});
