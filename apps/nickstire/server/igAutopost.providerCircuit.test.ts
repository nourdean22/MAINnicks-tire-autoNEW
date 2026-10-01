import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Provider ladder with the circuit breaker (2026-10-01).
 *
 * Railway, every static autopost 09-29 → 10-01: Higgsfield `not_enough_credits`
 * → OpenRouter 402 → HF FLUX 410 → direct Gemini finally rendered. Three dead
 * hops per post. After one credits failure the ladder must skip Higgsfield on
 * the next post and go straight to the shared generator; the retired HF hop no
 * longer exists at all.
 */
const { dbRows, hgGenerate, storagePut, fallbackGenerate } = vi.hoisted(() => ({
  dbRows: [] as Array<{ k: string; v: string }>,
  hgGenerate: vi.fn<() => Promise<string>>(),
  storagePut: vi.fn(async (name: string) => ({ url: `https://cdn.nickstire.org/${name}` })),
  fallbackGenerate: vi.fn(async () => ({ url: "https://fallback.example/img.png" })),
}));

vi.mock("./lib/db-helper", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(dbRows);
  const database = { select: () => chain };
  return { db: async () => database, dbTyped: async () => database, requireDb: async () => database };
});
vi.mock("./services/higgsfieldStudio", () => ({
  generateCarouselSlideImage: hgGenerate,
  getHiggsfieldCredentialsJson: async () => JSON.stringify({ key: "test" }),
}));
vi.mock("./storage", () => ({ storagePut }));
vi.mock("./_core/imageGeneration", () => ({ generateImage: fallbackGenerate }));

import { generatePostImage } from "./services/igAutopost";
import { __resetCircuits, circuitOpen } from "./services/imageProviderCircuit";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const CREDITS = new Error('Higgsfield CLI exited with code 3. Stderr: Error: {"billing_period":"monthly","error_type":"not_enough_credits","plan_type":"ultra"}');

beforeEach(() => {
  __resetCircuits();
  dbRows.length = 0;
  dbRows.push({ k: "ig_autopost_image_provider", v: "higgsfield" });
  hgGenerate.mockReset();
  storagePut.mockClear();
  fallbackGenerate.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => TINY_PNG.buffer.slice(TINY_PNG.byteOffset, TINY_PNG.byteOffset + TINY_PNG.byteLength),
  })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  __resetCircuits();
});

describe("generatePostImage · circuit breaker on the Higgsfield rung", () => {
  it("a credits failure falls back AND opens the circuit; the next post skips Higgsfield entirely", async () => {
    hgGenerate.mockRejectedValueOnce(CREDITS).mockResolvedValue("https://higgsfield.example/should-not-be-called.png");

    const first = await generatePostImage("worn tread macro");
    expect(hgGenerate).toHaveBeenCalledTimes(1);
    expect(fallbackGenerate).toHaveBeenCalledTimes(1);
    expect(first.kind).toBe("ai");
    expect(circuitOpen("higgsfield")).toMatchObject({ klass: "credits" });

    const second = await generatePostImage("rotor rust macro");
    // POSITIVE CONTROL for the old behaviour: before the breaker this was 2.
    expect(hgGenerate).toHaveBeenCalledTimes(1);
    expect(fallbackGenerate).toHaveBeenCalledTimes(2);
    expect(second.kind).toBe("ai");
  });

  it("a transient failure falls back but does NOT open the circuit", async () => {
    hgGenerate.mockRejectedValueOnce(new Error("ETIMEDOUT")).mockResolvedValue("https://higgsfield.example/ok.png");
    await generatePostImage("a");
    expect(circuitOpen("higgsfield")).toBeNull();
    await generatePostImage("b");
    expect(hgGenerate).toHaveBeenCalledTimes(2);
  });

  it("the ladder never calls a Hugging Face endpoint, even with HF_API_KEY and OpenRouter configured", async () => {
    vi.stubEnv("HF_API_KEY", "hf-test");
    vi.stubEnv("OPENAI_BASE_URL", "https://openrouter.ai/api/v1");
    vi.stubEnv("OPENAI_API_KEY", "or-test");
    hgGenerate.mockRejectedValue(CREDITS);
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("openrouter.ai")) {
        return { ok: false, status: 402, statusText: "Payment Required", text: async () => '{"error":{"message":"Insufficient credits"}}', json: async () => ({}) } as unknown as Response;
      }
      return { ok: true, status: 200, arrayBuffer: async () => TINY_PNG.buffer.slice(TINY_PNG.byteOffset, TINY_PNG.byteOffset + TINY_PNG.byteLength) } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await generatePostImage("x");
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("huggingface"))).toBe(false);
    expect(fallbackGenerate).toHaveBeenCalled();
    expect(circuitOpen("openrouter")).toMatchObject({ klass: "credits" });
  });
});
