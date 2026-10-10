/**
 * Audit 2026-10-10 04-H3: on a provider outage the marketing specialist
 * shipped canned "I am ready to coordinate..." copy (selection sentinel) or
 * the outage apology itself (reply sentinel) as a finished specialist turn.
 * A sentinel must hand back so specialist-routing falls through to the main
 * lane (it already passes on handBack: true).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChat = vi.fn();
vi.mock("@/lib/ai/traced-aichat", () => ({
  makeTracedAiChat: () => (...a: unknown[]) => mockChat(...a),
}));

vi.mock("@/lib/ai/agents/marketing/loader", () => ({
  getMarketingPersonas: () => ({
    "marketing-seo-strategist": {
      role: "SEO strategist",
      goal: "rank pages",
      backstory: "b",
      outputHint: "o",
    },
  }),
}));

import { runMarketingDirector } from "@/lib/ai/agents/specialists/marketing-director";

const SENTINEL = {
  content: "I'm having trouble connecting to my AI providers right now. try again in a moment.",
  provider: "emergency",
  model: "none",
};
const ok = (content: string) => ({ content, provider: "ollama", model: "m" });
const INPUT = { messages: [{ role: "user" as const, content: "Plan an SEO campaign for the shop" }] };

beforeEach(() => {
  mockChat.mockReset();
});

describe("runMarketingDirector - provider sentinel", () => {
  it("selection sentinel hands back to the main lane, no canned copy", async () => {
    mockChat.mockResolvedValueOnce(SENTINEL);
    const res = await runMarketingDirector(INPUT);
    expect(res.handBack).toBe(true);
    expect(res.reason).toBe("provider_unavailable");
    expect(res.content).toBe("");
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it("reply sentinel hands back instead of shipping the outage text", async () => {
    mockChat.mockResolvedValueOnce(ok("marketing-seo-strategist")).mockResolvedValueOnce(SENTINEL);
    const res = await runMarketingDirector(INPUT);
    expect(res.handBack).toBe(true);
    expect(res.reason).toBe("provider_unavailable");
    expect(res.content).not.toContain("trouble connecting");
  });

  it("no matching persona hands back instead of canned 'ready to coordinate' copy", async () => {
    mockChat.mockResolvedValueOnce(ok("general"));
    const res = await runMarketingDirector(INPUT);
    expect(res.handBack).toBe(true);
    expect(res.content).not.toContain("ready to coordinate");
  });

  it("control: a real reply is served by the specialist", async () => {
    mockChat
      .mockResolvedValueOnce(ok("marketing-seo-strategist"))
      .mockResolvedValueOnce(ok("Target three local keywords first."));
    const res = await runMarketingDirector(INPUT);
    expect(res.handBack).toBe(false);
    expect(res.content).toBe("Target three local keywords first.");
    expect(res.provider).toBe("ollama");
  });
});
