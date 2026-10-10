/**
 * Audit 2026-10-10 sentinel sweep (Task 2b): on a provider outage the
 * ghostwriter returned the "I'm having trouble connecting..." apology as the
 * draft. Its callers (operator.ghostwrite, /draft on Telegram) persist that
 * text as a pending social post. A sentinel must throw AiUnavailableError so
 * the callers' existing error paths run and nothing is queued.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChat = vi.fn();
vi.mock("@/lib/ai/traced-aichat", () => ({
  makeTracedAiChat: () => (...a: unknown[]) => mockChat(...a),
}));
vi.mock("@/lib/ai/nour-voice-profile", () => ({ buildNourVoicePrompt: () => "VOICE" }));
const critique = vi.fn();
vi.mock("@/lib/ai/output-critic", () => ({ critiqueContent: (t: string) => critique(t) }));
vi.mock("@/lib/brain/persona-drift-detector", () => ({ getPersonaAnchorPrompt: async () => "" }));
vi.mock("@/lib/ai/content-feedback", () => ({
  recallRecentContentFeedback: async () => [],
  buildFeedbackPromptBlock: () => "",
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { brainMemory: { findFirst: vi.fn().mockResolvedValue(null) } },
}));

import { ghostwrite } from "@/lib/ai/ghostwriter";
import { AiUnavailableError } from "@/lib/ai/structured";

const SENTINEL = {
  content: "I'm having trouble connecting to my AI providers right now. try again in a moment.",
  provider: "emergency",
  model: "none",
};
const ok = (content: string) => ({ content, provider: "ollama", model: "m" });

beforeEach(() => {
  mockChat.mockReset();
  critique.mockReset().mockReturnValue({ shouldRegen: false, contentOverall: 80, offenders: {} });
});

describe("ghostwrite - provider sentinel", () => {
  it("throws AiUnavailableError instead of returning the outage text as a draft", async () => {
    mockChat.mockResolvedValue(SENTINEL);
    await expect(ghostwrite({ brief: "winter tire promo", channel: "social" })).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
  });

  it("keeps the first draft when the regen pass hits a sentinel", async () => {
    critique.mockImplementation((t: string) =>
      t.startsWith("I'm having")
        ? { shouldRegen: false, contentOverall: 99, offenders: {} }
        : { shouldRegen: true, contentOverall: 40, offenders: { cliches: ["game changer"] } },
    );
    mockChat.mockResolvedValueOnce(ok("Winter tires: $89 mounted this week.")).mockResolvedValueOnce(SENTINEL);
    const out = await ghostwrite({ brief: "winter tire promo", channel: "social" });
    expect(out.text).toBe("Winter tires: $89 mounted this week.");
    expect(out.regenApplied).toBe(false);
  });

  it("control: a real draft is returned", async () => {
    mockChat.mockResolvedValue(ok("Winter tires: $89 mounted this week."));
    const out = await ghostwrite({ brief: "winter tire promo", channel: "social" });
    expect(out.text).toBe("Winter tires: $89 mounted this week.");
  });
});
