/**
 * AI-assistant attribution classifier (shared/aiReferral.ts), 2026-10-21.
 *
 * Two customers came in on 2026-10-21 because ChatGPT and Meta AI named the
 * shop. bookings, leads and call_events already keep utmSource and referrer;
 * this function decides which of those rows came from an assistant. The host
 * match is on a dot boundary so a look-alike domain is never counted.
 */
import { describe, expect, it } from "vitest";

import { aiAssistantFromAttribution } from "../shared/aiReferral";

describe("aiAssistantFromAttribution", () => {
  it.each([
    [{ referrer: "https://chatgpt.com/" }, "chatgpt"],
    [{ utmSource: "chatgpt.com" }, "chatgpt"],
    [{ referrer: "https://chat.openai.com/c/abc" }, "chatgpt"],
    [{ referrer: "https://www.perplexity.ai/search?q=x" }, "perplexity"],
    [{ utmSource: "Perplexity" }, "perplexity"],
    [{ utmSource: "PERPLEXITY.AI" }, "perplexity"],
    [{ referrer: "https://www.meta.ai/" }, "meta_ai"],
    [{ referrer: "https://gemini.google.com/app" }, "gemini"],
    [{ referrer: "https://copilot.microsoft.com/" }, "copilot"],
    [{ referrer: "https://claude.ai/new" }, "claude"],
    [{ referrer: "https://grok.com/" }, "other"],
    [{ utmSource: "meta_ai" }, "meta_ai"],
  ] as const)("%j -> %s", (input, expected) => {
    expect(aiAssistantFromAttribution(input)).toBe(expected);
  });

  it.each([
    [{ referrer: "https://notchatgpt.com/" }],
    [{ referrer: "https://chatgpt.com.evil.io/" }],
    [{ referrer: "not a url" }],
    [{ referrer: "https://www.google.com/" }],
    [{ referrer: "https://google.com/" }], // gemini is a google.com SUBdomain; the parent is not gemini
    [{ utmSource: "google" }],
    [{ utmSource: "chatgpt.com.evil.io" }],
    [{ utmSource: "" , referrer: "" }],
    [{ utmSource: null, referrer: null }],
    [{}],
  ] as const)("%j -> null", (input) => {
    expect(aiAssistantFromAttribution(input)).toBeNull();
  });

  it("utmSource wins over a non-AI referrer, and a non-AI utm falls through to an AI referrer", () => {
    expect(aiAssistantFromAttribution({ utmSource: "chatgpt.com", referrer: "https://www.google.com/" })).toBe("chatgpt");
    expect(aiAssistantFromAttribution({ utmSource: "newsletter", referrer: "https://www.meta.ai/" })).toBe("meta_ai");
  });
});
