import { beforeEach, describe, expect, it, vi } from "vitest";
import { transcribeAudio } from "@/lib/ai/stt";

/**
 * The chain exists because a PRESENT key proved invalid (whisper 401,
 * 2026-08-27). These canaries pin the contract: configured = key set;
 * validity is only learned by calling; failures fall through loudly
 * and the result names who actually transcribed.
 */

const blob = () => new Blob([new Uint8Array(1024)], { type: "audio/mpeg" });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.stubEnv("GROQ_API_KEY", "");
  vi.stubEnv("HF_API_KEY", "");
  vi.stubEnv("HUGGINGFACE_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
});

describe("transcribeAudio chain", () => {
  it("groq first when configured — result names the engine (positive control)", async () => {
    vi.stubEnv("GROQ_API_KEY", "gk");
    vi.stubEnv("HF_API_KEY", "hk");
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toContain("api.groq.com");
      return jsonResponse({ text: "hello", segments: [{ start: 0, end: 1, text: "hello" }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await transcribeAudio(blob(), "a.mp3");
    expect(result.engine).toBe("groq");
    expect(result.text).toBe("hello");
    expect(result.degraded).toBe(false);
    expect(result.segments).toEqual([{ start: 0, end: 1, text: "hello" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a PRESENT but DEAD key falls through — key presence is not validity", async () => {
    vi.stubEnv("GROQ_API_KEY", "dead");
    vi.stubEnv("HF_API_KEY", "hk");
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("api.groq.com")) return jsonResponse({ error: "invalid key" }, 401);
      return jsonResponse({ text: "rescued by hf" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await transcribeAudio(blob(), "a.mp3");
    expect(result.engine).toBe("hf");
    expect(result.text).toBe("rescued by hf");
    expect(result.degraded).toBe(true); // the degradation is VISIBLE
    expect(result.failures.join(" ")).toContain("groq");
  });

  it("skips unconfigured lanes without counting them as failures", async () => {
    vi.stubEnv("HF_API_KEY", "hk"); // only hf configured
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ text: "hf only" })));
    const result = await transcribeAudio(blob(), "a.mp3");
    expect(result.engine).toBe("hf");
    expect(result.degraded).toBe(false); // nothing configured failed before it
    expect(result.segments).toBeNull(); // hf lane has no timings — explicit, not empty
  });

  it("throws with EVERY per-lane reason when all configured lanes fail — no silent success", async () => {
    vi.stubEnv("HF_API_KEY", "hk");
    vi.stubEnv("OPENAI_API_KEY", "dead");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "down" }, 500)));
    await expect(transcribeAudio(blob(), "a.mp3")).rejects.toThrow(/hf.*openai|openai.*hf/s);
  });

  it("throws a configuration error when NO lane has a key", async () => {
    await expect(transcribeAudio(blob(), "a.mp3")).rejects.toThrow("no STT lane configured");
  });

  it("HUGGINGFACE_API_KEY works as the hf lane alias", async () => {
    vi.stubEnv("HUGGINGFACE_API_KEY", "alias-key");
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(String(url)).toContain("huggingface.co");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer alias-key");
      return jsonResponse({ text: "via alias" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await transcribeAudio(blob(), "a.mp3");
    expect(result.text).toBe("via alias");
  });
});
