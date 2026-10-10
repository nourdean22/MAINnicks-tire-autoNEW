/**
 * Audit 2026-10-10 04-F1 (S1): CoVe checked only provider "none", so the
 * "emergency" sentinel (non-empty apology prose) became a "verified fact" or
 * replaced the draft outright, and the outage text was saved as the reply.
 * A sentinel on ANY of the three calls must leave the draft untouched.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChat = vi.fn();
vi.mock("@/lib/ai/traced-aichat", () => ({
  makeTracedAiChat: () => (...a: unknown[]) => mockChat(...a),
}));

import { verifyAndRevise } from "@/lib/ai/chat/chain-of-verification";

const SENTINEL = {
  content: "I'm having trouble connecting to my AI providers right now. try again in a moment.",
  provider: "emergency",
  model: "none",
};
const ok = (content: string) => ({ content, provider: "ollama", model: "m" });

const DRAFT =
  "You have 12 open estimates this week and the oil change is advertised at $49.99 at the Euclid shop.";
const QUESTION = "How many open estimates do I have?";

beforeEach(() => {
  mockChat.mockReset();
});

describe("verifyAndRevise - provider sentinel", () => {
  it("plan sentinel: returns the draft unchanged", async () => {
    mockChat.mockResolvedValueOnce(SENTINEL);
    const res = await verifyAndRevise(DRAFT, QUESTION);
    expect(res.changed).toBe(false);
    expect(res.revised).toBe(DRAFT);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it("answer sentinels are never counted as verified facts (no revise call)", async () => {
    mockChat
      .mockResolvedValueOnce(ok('["How many open estimates are there?", "What is the oil change price?"]'))
      .mockResolvedValueOnce(SENTINEL)
      .mockResolvedValueOnce(SENTINEL)
      .mockResolvedValueOnce(ok("A completely rewritten draft that should never be used."));
    const res = await verifyAndRevise(DRAFT, QUESTION);
    expect(res.changed).toBe(false);
    expect(res.revised).toBe(DRAFT);
    // plan + 2 answers; the revise pass must not run on sentinel "facts"
    expect(mockChat).toHaveBeenCalledTimes(3);
  });

  it("revise sentinel never replaces the draft", async () => {
    mockChat
      .mockResolvedValueOnce(ok('["How many open estimates are there?"]'))
      .mockResolvedValueOnce(ok("There are 12 open estimates."))
      .mockResolvedValueOnce(SENTINEL);
    const res = await verifyAndRevise(DRAFT, QUESTION);
    expect(res.changed).toBe(false);
    expect(res.revised).toBe(DRAFT);
    expect(res.revised).not.toContain("trouble connecting");
  });

  it("control: a real revise still changes the draft", async () => {
    mockChat
      .mockResolvedValueOnce(ok('["How many open estimates are there?"]'))
      .mockResolvedValueOnce(ok("There are 9 open estimates."))
      .mockResolvedValueOnce(ok("You have 9 open estimates this week and the oil change is advertised at $49.99."));
    const res = await verifyAndRevise(DRAFT, QUESTION);
    expect(res.changed).toBe(true);
    expect(res.revised).toContain("9 open estimates");
  });
});
