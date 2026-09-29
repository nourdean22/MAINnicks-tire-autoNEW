import { afterEach, describe, expect, it, vi } from "vitest";
import { choice, noul } from "@/lib/ai/decision-plane/questions";
import {
  SystemOneHttpBackend,
  isPrivateDecisionEndpoint,
} from "@/lib/ai/decision-plane/system-one-http";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decision backend endpoint policy", () => {
  it("recognizes private endpoints", () => {
    expect(isPrivateDecisionEndpoint("http://127.0.0.1:8000")).toBe(true);
    expect(isPrivateDecisionEndpoint("http://10.1.2.3:8000")).toBe(true);
    expect(isPrivateDecisionEndpoint("http://decider.railway.internal:8000")).toBe(true);
  });
});

describe("SystemOneHttpBackend policy", () => {
  it("requires explicit opt-in for a public endpoint", () => {
    expect(
      () =>
        new SystemOneHttpBackend({
          id: "hosted",
          baseUrl: "https://example.com",
          model: "candidate",
        }),
    ).toThrow(/ALLOW_EXTERNAL_STATE/);

    const backend = new SystemOneHttpBackend({
      id: "hosted",
      baseUrl: "https://example.com",
      model: "candidate",
      allowExternalState: true,
    });
    expect(backend.trust).toBe("external");
  });
});

describe("SystemOneHttpBackend response validation", () => {
  const questions = {
    intent: choice("intent?", { factual: null, analytical: null }),
    needsWeb: noul("needs web?"),
  } as const;

  it("accepts a valid TypeSafe-compatible response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "kev-latest",
          answers: {
            intent: {
              type: "choice",
              choice: "analytical",
              confidence: 0.8,
              probabilities: { factual: 0.1, analytical: 0.9 },
            },
            needsWeb: { type: "noul", noul: 0.72 },
          },
          usage: { input_tokens: 31, output_tokens: 2 },
        }),
        { status: 200, headers: { "x-typesafe-request-id": "req-1" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const backend = new SystemOneHttpBackend({
      id: "kev",
      baseUrl: "http://127.0.0.1:8008",
      model: "kev-latest",
    });
    const result = await backend.evaluate({
      state: { message: "compare these options" },
      questions,
    });

    expect(result).toMatchObject({
      backend: "kev",
      model: "kev-latest",
      requestId: "req-1",
    });
    expect(result.answers.intent).toMatchObject({
      type: "choice",
      choice: "analytical",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).toMatchObject({ model: "kev-latest", questions });
  });

  it("rejects a malformed probability distribution", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            model: "bad",
            answers: {
              intent: {
                type: "choice",
                choice: "analytical",
                confidence: 0.8,
                probabilities: { factual: 0.1, analytical: 0.1 },
              },
              needsWeb: { type: "noul", noul: 0.4 },
            },
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 },
        ),
      ),
    );

    const backend = new SystemOneHttpBackend({
      id: "bad",
      baseUrl: "http://localhost:8000",
      model: "bad",
    });

    await expect(
      backend.evaluate({ state: "x", questions }),
    ).rejects.toThrow(/sum to/);
  });
});
