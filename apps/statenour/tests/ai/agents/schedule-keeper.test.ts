/**
 * tests/ai/agents/schedule-keeper.test.ts · Task #16.
 *
 * Locks the schedule-keeper contract · mirrors the financial-analyst
 * / decision-coach test shape: persona framing, hand-back stripping,
 * provider-failure path. NO real LLM calls — provider.aiChat is
 * mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentTrace: { create: vi.fn() },
  },
}));

vi.mock("@/lib/ai/provider", () => ({
  aiChat: vi.fn(),
}));

import { aiChat } from "@/lib/ai/provider";
import {
  runScheduleKeeper,
  __testInternals,
} from "@/lib/ai/agents/specialists/schedule-keeper";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("schedule-keeper · system prompt framing", () => {
  it("ships the schedule-keeper persona block to aiChat", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "Thursday 2-4pm · your usual deep block is open.",
      provider: "ollama",
      model: "qwen3",
    });

    await runScheduleKeeper({
      messages: [
        { role: "user", content: "when can I fit the proposal this week?" },
      ],
    });

    const messages = vi.mocked(aiChat).mock.calls[0]?.[0];
    expect(messages).toBeTruthy();
    expect(messages?.[0].role).toBe("system");
    expect(messages?.[0].content).toContain("SCHEDULE KEEPER");
    // Critical biases for this specialist.
    expect(messages?.[0].content).toMatch(/concrete time-slots?/i);
    expect(messages?.[0].content).toMatch(/free.?blocks?|free.?slots?/i);
    expect(messages?.[0].content).toMatch(/reschedul/i);
    // The "no moralizing about discipline" rule (mirrors the
    // task-reschedule-with-reason eval scenario rubric).
    expect(messages?.[0].content.toLowerCase()).toContain("moralize");
    // Hand-back protocol must be present.
    expect(messages?.[0].content).toContain("[[HANDBACK:");
    // The decision-vs-schedule distinction must be in the prompt so
    // the model hands back correctly when Nour pivots to a CHOICE.
    expect(messages?.[0].content).toMatch(/decision-coach|CHOOSING|PLACING/i);
  });

  it("includes the full conversation history after the system prompt", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "OK.",
      provider: "ollama",
      model: "qwen3",
    });

    await runScheduleKeeper({
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "first reply" },
        { role: "user", content: "second" },
      ],
    });

    const messages = vi.mocked(aiChat).mock.calls[0]?.[0];
    expect(messages?.length).toBe(4);
    expect(messages?.[3].content).toBe("second");
  });

  it("routes via taskType='reason' (matches sibling specialists)", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "Pushed to Friday.",
      provider: "venice",
      model: "venice-uncensored",
    });

    await runScheduleKeeper({
      messages: [{ role: "user", content: "push the proposal to Friday" }],
    });

    // Sibling specialists pin taskType='reason' so this lane uses the
    // same provider-chain shape (Venice / Ollama first).
    expect(vi.mocked(aiChat).mock.calls[0]?.[1]).toBe("reason");
  });
});

describe("schedule-keeper · hand-back marker stripping", () => {
  it("strips marker + reports handBack=true when present", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content:
        "Pushed to Friday. Heads up — your marketing review is also Fri PM.\n[[HANDBACK: user pivoted to a money snapshot]]",
      provider: "ollama",
      model: "qwen3",
    });

    const result = await runScheduleKeeper({
      messages: [
        { role: "user", content: "push the proposal to friday" },
        { role: "assistant", content: "..." },
        { role: "user", content: "ok now what's my net worth" },
      ],
    });

    expect(result.handBack).toBe(true);
    expect(result.reason).toContain("money snapshot");
    expect(result.content).not.toContain("HANDBACK");
    expect(result.content).toContain("Pushed to Friday");
  });

  it("returns handBack=false when no marker is present", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "Tuesday 9-11am · your usual deep block is open.",
      provider: "venice",
      model: "venice-uncensored",
    });

    const result = await runScheduleKeeper({
      messages: [
        { role: "user", content: "when's a good 2hr block this week?" },
      ],
    });

    expect(result.handBack).toBe(false);
    expect(result.content).toBe("Tuesday 9-11am · your usual deep block is open.");
  });
});

describe("schedule-keeper · provider failure path", () => {
  it("returns a hand-back when aiChat reports provider='none'", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "AI is currently unavailable.",
      provider: "none",
      model: "none",
    });

    const result = await runScheduleKeeper({
      messages: [{ role: "user", content: "when can I fit a 90-min block?" }],
    });

    expect(result.handBack).toBe(true);
    expect(result.reason).toContain("providers unavailable");
  });

  it("returns a hand-back when aiChat reports provider='emergency'", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "I'm having trouble connecting...",
      provider: "emergency",
      model: "none",
    });

    const result = await runScheduleKeeper({
      messages: [{ role: "user", content: "reschedule the proposal" }],
    });

    expect(result.handBack).toBe(true);
    expect(result.provider).toBe("emergency");
  });
});

describe("schedule-keeper · internals (sanity check)", () => {
  it("exports the system prompt under __testInternals", () => {
    expect(__testInternals.SCHEDULE_SYSTEM_PROMPT).toContain("SCHEDULE KEEPER");
  });

  it("system prompt forbids cheerleading tone (matches state-aware rubric)", () => {
    // The eval scenario task-reschedule-with-reason checks for steady
    // (non-chirpy) tone · the persona must encode that constraint.
    expect(__testInternals.SCHEDULE_SYSTEM_PROMPT.toLowerCase()).toMatch(
      /chirpy|cheerleading|moralize|pushing through/,
    );
  });
});
