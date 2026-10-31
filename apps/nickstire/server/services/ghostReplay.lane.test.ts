/**
 * Ghost replay · lane discipline (self-learning W1a, 2026-10-30).
 *
 * The receptionist evaluation now runs nightly, so it must (1) never leave the
 * Ollama lane on a quota refusal (ollamaOnly on every replay and judge call)
 * and (2) back off on a 429 instead of counting a rate limit as a lane failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invokeLLM: vi.fn(), judgeResolution: vi.fn() }));
vi.mock("../_core/llm", () => ({ invokeLLM: mocks.invokeLLM }));
vi.mock("./resolutionJudge", () => ({ judgeResolution: mocks.judgeResolution }));

import { ghostReplay, gradeRepliesWithJudge, RATE_LIMIT_BACKOFF_MS } from "./ghostReplay";

const reply = (text: string) => ({ choices: [{ message: { content: text } }] });
const rateLimited = () => new Error("LLM invoke failed: 429 Too Many Requests – slow down");

describe("ghostReplay lane", () => {
  beforeEach(() => {
    mocks.invokeLLM.mockReset();
    mocks.judgeResolution.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("every replay call is Ollama-only", async () => {
    mocks.invokeLLM.mockResolvedValue(reply("We can look at that today."));
    await ghostReplay("prompt", ["My tire is flat", "Can you fix it?"]);
    expect(mocks.invokeLLM).toHaveBeenCalledTimes(2);
    for (const [params] of mocks.invokeLLM.mock.calls) expect(params.ollamaOnly).toBe(true);
  });

  it("a 429 waits and retries; the reply comes from the retry", async () => {
    vi.useFakeTimers();
    mocks.invokeLLM.mockRejectedValueOnce(rateLimited()).mockResolvedValueOnce(reply("Come on in."));
    const p = ghostReplay("prompt", ["Are you open?"]);
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_BACKOFF_MS[0]);
    await expect(p).resolves.toEqual(["Come on in."]);
    expect(mocks.invokeLLM).toHaveBeenCalledTimes(2);
  });

  it("gives up after the last backoff and rethrows the 429", async () => {
    vi.useFakeTimers();
    mocks.invokeLLM.mockRejectedValue(rateLimited());
    const p = ghostReplay("prompt", ["Are you open?"]);
    const settled = expect(p).rejects.toThrow(/429/);
    for (const ms of RATE_LIMIT_BACKOFF_MS) await vi.advanceTimersByTimeAsync(ms);
    await settled;
    expect(mocks.invokeLLM).toHaveBeenCalledTimes(RATE_LIMIT_BACKOFF_MS.length + 1);
  });

  it("any other error is not retried", async () => {
    mocks.invokeLLM.mockRejectedValue(new Error("LLM invoke failed: 500 Internal"));
    await expect(ghostReplay("prompt", ["hi"])).rejects.toThrow(/500/);
    expect(mocks.invokeLLM).toHaveBeenCalledTimes(1);
  });

  it("does not wait past the run's budget: a 429 with too little time left rethrows at once", async () => {
    mocks.invokeLLM.mockRejectedValue(rateLimited());
    const budget = { remainingMs: () => RATE_LIMIT_BACKOFF_MS[0] - 1 };
    await expect(ghostReplay("prompt", ["hi"], { budget })).rejects.toThrow(/429/);
    expect(mocks.invokeLLM).toHaveBeenCalledTimes(1);
  });

  it("the judge call carries ollamaOnly when the grader asks for it", async () => {
    mocks.judgeResolution.mockResolvedValue({ verdict: "resolved", reason: "ok" });
    await gradeRepliesWithJudge(["My tire is flat"], ["Bring it in today."], { ollamaOnly: true });
    expect(mocks.judgeResolution.mock.calls[0][2]).toMatchObject({ ollamaOnly: true });
  });
});
