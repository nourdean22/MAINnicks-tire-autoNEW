import { describe, expect, it } from "vitest";
import {
  classifyImageGenerationError,
  ImageGenerationError,
} from "@/lib/ai/gemini-image";
import { looksLikeImageGenerationRequest } from "@/lib/ai/chat/handlers/patterns";

describe("image generation failure contract", () => {
  it("treats a monthly spend cap as terminal instead of a transient 429", () => {
    const failure = classifyImageGenerationError(
      new Error(
        'Gemini image generation failed (429): project has exceeded its monthly spending cap',
      ),
    );

    expect(failure).toMatchObject({ kind: "quota", retryable: false });
    expect(failure.userMessage).not.toContain("429");
    expect(failure.userMessage).not.toContain("monthly spending cap");
  });

  it("keeps a normal rate limit retryable", () => {
    expect(classifyImageGenerationError(new Error("HTTP 429 rate limit"))).toMatchObject({
      kind: "rate_limit",
      retryable: true,
    });
  });

  it("does not expose a provider payload in the typed error", () => {
    const failure = classifyImageGenerationError(
      new Error("Both providers failed: secret-looking provider response body"),
    );
    const typed = new ImageGenerationError(failure);

    expect(typed.message).not.toContain("secret-looking");
    expect(typed.message).not.toContain("Both providers");
  });
});

describe("image retry guard", () => {
  it("recognizes direct natural-language image requests", () => {
    expect(looksLikeImageGenerationRequest("create a pic of a red car")).toBe(true);
    expect(looksLikeImageGenerationRequest("/image a red car")).toBe(true);
  });

  it("does not classify metaphorical image language as a generation request", () => {
    expect(looksLikeImageGenerationRequest("create an image plan for the launch")).toBe(false);
  });
});
