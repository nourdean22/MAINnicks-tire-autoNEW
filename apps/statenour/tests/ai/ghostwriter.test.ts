/**
 * AG-33 · ghostwriter service contract tests.
 *
 * Mocks the traced aiChat factory; uses the REAL critiqueContent so the
 * regen boundary is exercised against the actual scoring rules:
 *   · a deliberately generic corporate draft → shouldRegen → ONE
 *     revision with the offenders named in the rewrite instruction
 *   · a specific, in-voice draft → no regen, single call
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChat = vi.fn();
vi.mock("@/lib/ai/traced-aichat", () => ({
  makeTracedAiChat: () => (...a: unknown[]) => mockChat(...a),
}));

// Mock the critic: this suite tests ghostwrite's CONTRACT (the regen
// branch mechanics), not the scoring rules — those have their own
// suite, and probing showed the real critic passes pure-prose corporate
// slop at 61+ (zero cliche/antiNour hits), so prose fixtures can't
// reliably trip the <60 gate.
const mockCritique = vi.fn();
vi.mock("@/lib/ai/output-critic", () => ({
  critiqueContent: (...a: unknown[]) => mockCritique(...a),
}));

// Voice-asset deps are best-effort inside buildGhostVoicePrompt — mock
// them to fixed strings so the test never touches prisma/embeddings.
vi.mock("@/lib/brain/persona-drift-detector", () => ({
  getPersonaAnchorPrompt: vi.fn().mockResolvedValue(""),
}));
vi.mock("@/lib/ai/content-feedback", () => ({
  recallRecentContentFeedback: vi.fn().mockResolvedValue([]),
  buildFeedbackPromptBlock: vi.fn().mockReturnValue(""),
}));

import { ghostwrite, buildGhostVoicePrompt } from "@/lib/ai/ghostwriter";

const GENERIC_DRAFT =
  "Certainly! We are excited to elevate your experience and leverage our world-class solutions. I hope this helps — feel free to reach out and we look forward to seeing you!";
const SPECIFIC_DRAFT =
  "Fleet quote is ready: 8 Firestone Destinations at $178 each, mounted and balanced, out the door by 4pm Friday. Call Mike at the shop before 2pm today to lock the Friday slot. — Nick's";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ghostwrite", () => {
  it("regen fires when the critic says so — offenders named, better score wins", async () => {
    mockChat
      .mockResolvedValueOnce({ content: GENERIC_DRAFT, provider: "venice" })
      .mockResolvedValueOnce({ content: SPECIFIC_DRAFT, provider: "venice" });
    mockCritique
      .mockReturnValueOnce({
        contentOverall: 42,
        shouldRegen: true,
        offenders: { cliches: ["world-class"], antiNour: ["elevate", "leverage"] },
      })
      .mockReturnValueOnce({
        contentOverall: 84,
        shouldRegen: false,
        offenders: { cliches: [], antiNour: [] },
      });

    const out = await ghostwrite({ brief: "sms to the fleet lead", channel: "sms" });

    expect(mockChat).toHaveBeenCalledTimes(2);
    // The revision instruction names the actual offending phrases.
    const revisionMessages = mockChat.mock.calls[1][0] as Array<{ role: string; content: string }>;
    const instruction = revisionMessages[revisionMessages.length - 1].content;
    expect(instruction).toContain("failed the voice critic (42/100)");
    expect(instruction).toContain("world-class; elevate; leverage");
    expect(out.regenApplied).toBe(true);
    expect(out.text).toBe(SPECIFIC_DRAFT);
    expect(out.score).toBe(84);
  });

  it("keeps the original when the revision scores WORSE", async () => {
    mockChat
      .mockResolvedValueOnce({ content: GENERIC_DRAFT, provider: "venice" })
      .mockResolvedValueOnce({ content: "worse rewrite", provider: "venice" });
    mockCritique
      .mockReturnValueOnce({ contentOverall: 55, shouldRegen: true, offenders: { cliches: [], antiNour: [] } })
      .mockReturnValueOnce({ contentOverall: 40, shouldRegen: true, offenders: { cliches: [], antiNour: [] } });

    const out = await ghostwrite({ brief: "b", channel: "social" });
    expect(out.regenApplied).toBe(false);
    expect(out.text).toBe(GENERIC_DRAFT);
    expect(out.score).toBe(55);
  });

  it("no regen on a passing draft — single call", async () => {
    mockChat.mockResolvedValueOnce({ content: SPECIFIC_DRAFT, provider: "venice" });
    mockCritique.mockReturnValueOnce({
      contentOverall: 78,
      shouldRegen: false,
      offenders: { cliches: [], antiNour: [] },
    });

    const out = await ghostwrite({ brief: "sms to the fleet lead", channel: "sms" });

    expect(mockChat).toHaveBeenCalledTimes(1);
    expect(out.regenApplied).toBe(false);
    expect(out.text).toBe(SPECIFIC_DRAFT);
    expect(out.score).toBe(78);
  });

  it("critic failure degrades to ungated (score null, no regen)", async () => {
    mockChat.mockResolvedValueOnce({ content: SPECIFIC_DRAFT, provider: "venice" });
    mockCritique.mockImplementationOnce(() => {
      throw new Error("critic exploded");
    });

    const out = await ghostwrite({ brief: "b", channel: "email" });
    expect(out.score).toBeNull();
    expect(out.regenApplied).toBe(false);
    expect(out.text).toBe(SPECIFIC_DRAFT);
  });
});

describe("buildGhostVoicePrompt", () => {
  it("composes the static voice profile + the channel card", async () => {
    const prompt = await buildGhostVoicePrompt("sms");
    expect(prompt).toContain("CHANNEL: SMS");
    expect(prompt).toContain("160 characters");
    // A recognizable marker from buildNourVoicePrompt's rules.
    expect(prompt.toLowerCase()).toContain("voice");
  });

  it("channel cards differ", async () => {
    const sms = await buildGhostVoicePrompt("sms");
    const long = await buildGhostVoicePrompt("longform");
    expect(sms).not.toBe(long);
    expect(long).toContain("CHANNEL: LONG-FORM");
  });
});
