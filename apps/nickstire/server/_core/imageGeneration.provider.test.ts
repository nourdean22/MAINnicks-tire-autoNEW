/**
 * generateImage says WHICH provider answered (additive fields on the response). One call can start
 * on Gemini and finish on the OpenAI fallback; callers that report a model name (the admin Photo
 * Improver) must be able to tell the two apart. Fetch and storage are faked: no live call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { storagePut } = vi.hoisted(() => ({ storagePut: vi.fn() }));
vi.mock("../storage", () => ({ storagePut }));

import { generateImage } from "./imageGeneration";

const geminiOk = () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from("png").toString("base64"), mimeType: "image/png" } }] } }] }), { status: 200 });
const openaiOk = () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("png").toString("base64") }] }), { status: 200 });

beforeEach(() => {
  storagePut.mockReset();
  storagePut.mockResolvedValue({ url: "https://store.example.test/generated/x.png" });
  vi.stubEnv("GEMINI_API_KEY", "g-key");
  vi.stubEnv("OPENAI_API_KEY", "o-key");
  vi.stubEnv("GEMINI_IMAGE_MODEL", "gemini-test-image");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("generateImage provider report", () => {
  it("Gemini serving: provider gemini and the model it requested", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(geminiOk());
    vi.stubGlobal("fetch", fetchMock);
    const r = await generateImage({ prompt: "p" });
    expect(r).toEqual({ url: "https://store.example.test/generated/x.png", provider: "gemini", model: "gemini-test-image" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Gemini refusing, OpenAI fallback serving: provider openai and dall-e-3", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 503 })).mockResolvedValueOnce(openaiOk());
    vi.stubGlobal("fetch", fetchMock);
    const r = await generateImage({ prompt: "p" });
    expect(r).toEqual({ url: "https://store.example.test/generated/x.png", provider: "openai", model: "dall-e-3" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("no Gemini key: provider openai", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(openaiOk()));
    expect(await generateImage({ prompt: "p" })).toMatchObject({ provider: "openai", model: "dall-e-3" });
  });
});
