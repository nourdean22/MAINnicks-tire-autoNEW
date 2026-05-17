/**
 * Unit tests for lib/ai/vision-input.ts (v8.3 BATCH 18).
 *
 * Tests the message-shape normalization + provider fallback logic.
 * Real provider calls are mocked at fetch level — we never hit
 * network / OpenAI / Ollama from a unit test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { aiChatWithVision, describeImage } from "@/lib/ai/vision-input";

describe("aiChatWithVision", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Default env so callOpenAI / callAnthropic don't reject before fetching.
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.ANTHROPIC_API_KEY = "test-anthropic";
  });

  it("returns the first provider's response when ollama succeeds", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "ollama said hi" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const r = await aiChatWithVision([
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "image", imageUrl: "https://example.com/x.jpg" },
        ],
      },
    ]);
    expect(r.content).toBe("ollama said hi");
    expect(r.provider).toBe("ollama");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("falls through to openai when ollama 500s", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("ollama down", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "openai answer" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const r = await aiChatWithVision([
      { role: "user", content: "describe" },
    ]);
    expect(r.content).toBe("openai answer");
    expect(r.provider).toBe("openai");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("falls through to anthropic when ollama+openai both fail", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ content: [{ type: "text", text: "anthropic answer" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const r = await aiChatWithVision([{ role: "user", content: "x" }]);
    expect(r.content).toBe("anthropic answer");
    expect(r.provider).toBe("anthropic");
  });

  it("throws when all providers fail", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(
      aiChatWithVision([{ role: "user", content: "x" }]),
    ).rejects.toThrow();
  });

  it("respects preferredProvider", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "openai first" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const r = await aiChatWithVision(
      [{ role: "user", content: "x" }],
      { preferredProvider: "openai" },
    );
    expect(r.provider).toBe("openai");
    expect(fetchSpy.mock.calls[0][0]).toContain("openai.com");
  });

  it("normalizes multimodal content into the OpenAI shape", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await aiChatWithVision([
      {
        role: "user",
        content: [
          { type: "text", text: "what?" },
          { type: "image", imageUrl: "https://example.com/p.jpg" },
        ],
      },
    ]);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content[0]).toEqual({ type: "text", text: "what?" });
    expect(body.messages[0].content[1]).toEqual({
      type: "image_url",
      image_url: { url: "https://example.com/p.jpg" },
    });
  });
});

describe("describeImage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("wraps the URL in a single user message + default question", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "a cat" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const r = await describeImage("https://example.com/cat.png");
    expect(r.content).toBe("a cat");
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content[0].text).toMatch(/Describe/);
    expect(body.messages[0].content[1].image_url.url).toBe("https://example.com/cat.png");
  });
});
