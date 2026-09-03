/**
 * tests/ai/ollama-model-retirement-fallback.test.ts
 *
 * THE INCIDENT THIS PREVENTS: Ollama Cloud retires cloud models on a
 * rolling schedule and the id simply stops resolving. It has happened
 * twice here — qwen3-vl (2026-06-16, vision lane) and
 * deepseek-v3.1:671b (2026-07-15). The second took the whole
 * reason/chat lane down for ~9h, because the provider fallback chain
 * (ollama -> gemini -> openai -> openrouter) only helps when a
 * DIFFERENT provider is healthy, and every paid lane was simultaneously
 * exhausted. A retired model is not a provider outage: Ollama is up,
 * one id is gone.
 *
 * CANARY DISCIPLINE (root AGENTS.md): the dangerous failure here is not
 * "the fallback didn't fire" — it is "the fallback fired on something
 * that was NOT a retirement", silently masking a real outage as a
 * successful degraded response. So the scope guard is asserted in both
 * directions: 404/410 MUST retry, and 500/429/503 MUST NOT. Without the
 * negative half, widening the trigger to `!res.ok` would score green
 * while swallowing every server error in the stack.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/utils/error-log", () => ({
  logError: vi.fn().mockResolvedValue(undefined),
}));

import { fetchWithModelRetirementFallback } from "@/lib/ai/provider";

function res(status: number, body = "{}"): Response {
  return new Response(body, { status });
}

const URL_ = "https://ollama.com/v1/chat/completions";
const BODY = JSON.stringify({ model: "dead-model:671b", messages: [] });
const OPTS = { method: "POST", body: BODY } as RequestInit;

let fetchImpl: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchImpl = vi.fn();
});

describe("retirement path — 404/410 retries a sibling model", () => {
  it("retries on 404 and returns the fallback's response", async () => {
    fetchImpl.mockResolvedValueOnce(res(404)).mockResolvedValueOnce(res(200, '{"ok":true}'));

    const out = await fetchWithModelRetirementFallback(
      fetchImpl as unknown as typeof fetch,
      URL_,
      OPTS,
      "dead-model:671b",
      "gpt-oss:120b,glm-5.3"
    );

    expect(out.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries on 410 (Gone) — the status Ollama actually returned in the Jul incident", async () => {
    fetchImpl.mockResolvedValueOnce(res(410)).mockResolvedValueOnce(res(200));
    const out = await fetchWithModelRetirementFallback(
      fetchImpl as unknown as typeof fetch,
      URL_,
      OPTS,
      "dead-model:671b",
      "gpt-oss:120b"
    );
    expect(out.status).toBe(200);
  });

  it("rewrites the model id in the retry body — not just the URL", async () => {
    fetchImpl.mockResolvedValueOnce(res(404)).mockResolvedValueOnce(res(200));
    await fetchWithModelRetirementFallback(
      fetchImpl as unknown as typeof fetch,
      URL_,
      OPTS,
      "dead-model:671b",
      "gpt-oss:120b"
    );
    const retryInit = fetchImpl.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(retryInit.body as string).model).toBe("gpt-oss:120b");
  });

  it("walks the candidate list until one answers", async () => {
    fetchImpl
      .mockResolvedValueOnce(res(404)) // original
      .mockResolvedValueOnce(res(404)) // candidate 1 also retired
      .mockResolvedValueOnce(res(200)); // candidate 2 lives

    const out = await fetchWithModelRetirementFallback(
      fetchImpl as unknown as typeof fetch,
      URL_,
      OPTS,
      "dead-model:671b",
      "also-dead,gpt-oss:120b"
    );
    expect(out.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("skips a candidate identical to the failing model", async () => {
    fetchImpl.mockResolvedValueOnce(res(404)).mockResolvedValueOnce(res(200));
    await fetchWithModelRetirementFallback(
      fetchImpl as unknown as typeof fetch,
      URL_,
      OPTS,
      "dead-model:671b",
      "dead-model:671b,gpt-oss:120b"
    );
    const retryInit = fetchImpl.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(retryInit.body as string).model).toBe("gpt-oss:120b");
  });
});

describe("CANARY: the scope guard must NOT fire on a real outage", () => {
  // Widening the trigger to `!res.ok` would pass every positive test above
  // and silently convert server outages into "successful" degraded calls.
  it.each([500, 502, 503, 429, 400, 401])(
    "does NOT retry on %i — that is an outage or a client error, not a retirement",
    async (status) => {
      fetchImpl.mockResolvedValueOnce(res(status));

      const out = await fetchWithModelRetirementFallback(
        fetchImpl as unknown as typeof fetch,
        URL_,
        OPTS,
        "dead-model:671b",
        "gpt-oss:120b,glm-5.3"
      );

      expect(out.status).toBe(status);
      // Exactly one call: the fallback must not have engaged at all.
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  );

  it("passes a 200 straight through without touching it", async () => {
    fetchImpl.mockResolvedValueOnce(res(200, '{"pass":true}'));
    const out = await fetchWithModelRetirementFallback(
      fetchImpl as unknown as typeof fetch,
      URL_,
      OPTS,
      "live-model",
      "gpt-oss:120b"
    );
    expect(out.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("degradation is visible, never silent", () => {
  it("returns the original 404 when no fallbacks are configured", async () => {
    fetchImpl.mockResolvedValueOnce(res(404));
    const out = await fetchWithModelRetirementFallback(
      fetchImpl as unknown as typeof fetch,
      URL_,
      OPTS,
      "dead-model:671b",
      "" // unset
    );
    expect(out.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns the original response when every fallback is also retired", async () => {
    fetchImpl
      .mockResolvedValueOnce(res(404))
      .mockResolvedValueOnce(res(404))
      .mockResolvedValueOnce(res(410));

    const out = await fetchWithModelRetirementFallback(
      fetchImpl as unknown as typeof fetch,
      URL_,
      OPTS,
      "dead-model:671b",
      "dead-a,dead-b"
    );
    // Falls through to the provider chain rather than inventing success.
    expect(out.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("bails out rather than guessing when the body is not JSON", async () => {
    fetchImpl.mockResolvedValueOnce(res(404));
    const out = await fetchWithModelRetirementFallback(
      fetchImpl as unknown as typeof fetch,
      URL_,
      { method: "POST", body: "not-json" } as RequestInit,
      "dead-model:671b",
      "gpt-oss:120b"
    );
    expect(out.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
