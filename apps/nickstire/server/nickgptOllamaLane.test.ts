/**
 * 2026-10-30 · customer SMS drafts ride the funded Ollama lane when prod forces it.
 *
 * Prod sets AI_FORCE_OLLAMA=true with OLLAMA_API_KEY, but draftSmsReply never read
 * the flag: with no NICKGPT_OLLAMA_URL it fetched Gemini directly with a 110-token
 * cap and 22 of 23 October drafts came back cut. Under the flag the drafter now goes
 * through invokeLLM (same lane, slot scheduler and quota fallback as every other
 * Ollama call) with room above the SMS budget; Gemini stays as the fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./services/businessFacts", () => ({ buildWarrantyFactsPreambleLive: async () => "" }));
vi.mock("./services/featureFlags", () => ({ isEnabled: async () => true }));
const mockInvokeLLM = vi.fn();
vi.mock("./_core/llm", () => ({ invokeLLM: (...args: unknown[]) => mockInvokeLLM(...args) }));

import { draftSmsReply } from "./services/nickgpt-client";

const DONE = "Yes, we do alignments on trucks. Want to bring it by?";
const ollamaResult = (finish: string | null) => ({
  id: "x", created: 0, model: "deepseek-v4-pro",
  choices: [{ index: 0, message: { role: "assistant", content: DONE }, finish_reason: finish }],
});
const geminiBody = { choices: [{ index: 0, message: { role: "assistant", content: DONE }, finish_reason: "stop" }] };

describe("draftSmsReply · Ollama lane under AI_FORCE_OLLAMA", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    for (const k of ["NICKGPT_OLLAMA_URL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) vi.stubEnv(k, "");
    vi.stubEnv("AI_FORCE_OLLAMA", "true");
    vi.stubEnv("OLLAMA_API_KEY", "test-ollama");
    vi.stubEnv("GEMINI_API_KEY", "test-gemini");
    fetchMock = vi.fn(async () => new Response(JSON.stringify(geminiBody), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    mockInvokeLLM.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("drafts through invokeLLM at live priority with room for thinking, and labels the source", async () => {
    mockInvokeLLM.mockResolvedValue(ollamaResult("stop"));
    const res = await draftSmsReply({ inboundMessage: "do you do alignments on trucks", maxTokens: 110 });
    expect(mockInvokeLLM).toHaveBeenCalledTimes(1);
    const params = mockInvokeLLM.mock.calls[0][0];
    expect(params.maxTokens).toBeGreaterThanOrEqual(110 + 1024);
    // P0 = highest class (ollamaScheduler sorts ascending); a bounded slot wait
    // and call timeout let a busy account fall through to Gemini.
    expect(params.priority).toBe(0);
    expect(params.slotWaitMs).toBeGreaterThan(0);
    expect(params.slotWaitMs).toBeLessThanOrEqual(10_000);
    expect(params.timeoutMs).toBeLessThanOrEqual(20_000);
    expect(params.messages.at(-1)).toEqual({ role: "user", content: "do you do alignments on trucks" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: true, draft: DONE, source: "fallback-ollama-cloud", modelName: "deepseek-v4-pro", completion: "complete", finishReason: "stop" });
  });

  it("a length stop on the Ollama lane reads truncated", async () => {
    mockInvokeLLM.mockResolvedValue(ollamaResult("length"));
    const res = await draftSmsReply({ inboundMessage: "do you do alignments on trucks" });
    expect(res).toMatchObject({ ok: true, source: "fallback-ollama-cloud", completion: "truncated" });
  });

  it("an Ollama failure falls back to Gemini instead of going dark", async () => {
    mockInvokeLLM.mockRejectedValue(new Error("Ollama 503"));
    const res = await draftSmsReply({ inboundMessage: "do you do alignments on trucks" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ ok: true, draft: DONE, completion: "complete" });
  });

  it("positive control: without the flag the Ollama lane is not used", async () => {
    vi.stubEnv("AI_FORCE_OLLAMA", "");
    const res = await draftSmsReply({ inboundMessage: "do you do alignments on trucks" });
    expect(mockInvokeLLM).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ ok: true, completion: "complete" });
  });
});
