/**
 * Audit 04-X8 (side pane): the side pane has ZERO tools, yet a reply could
 * stream "I've added the task" and nothing anywhere detected it. The main
 * chat's L2 banner never runs here (no persist pipeline, client-owned thread).
 *
 * Pinned: the route records how many unbacked action claims a reply made on
 * its trace, and the client's completion handler banners such a reply before
 * it is stored in the thread.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let finishText = "";
vi.mock("ai", () => ({
  streamText: (cfg: { onFinish?: (e: { text: string }) => unknown }) => {
    void cfg.onFinish?.({ text: finishText });
    return { toTextStreamResponse: () => new Response(finishText) };
  },
}));
vi.mock("@/lib/observability/langfuse", () => ({ langfuseTelemetry: () => ({}) }));
vi.mock("@/lib/rate-limit", () => ({ checkAiRateLimit: () => null }));
vi.mock("@/lib/ai/provider", () => ({
  getActiveProviderInfo: () => ({ provider: "ollama", modelId: "m" }),
  getModel: () => ({}),
}));
vi.mock("@/lib/ai/system-prompt", () => ({ buildSystemPrompt: async () => "sys" }));
vi.mock("@/lib/ai/system-prompt-cache", () => ({ getCachedPrompt: () => "sys", setCachedPrompt: () => undefined }));
vi.mock("@/lib/ai/page-data", () => ({ buildPageData: async () => "" }));
vi.mock("@/lib/ai/strategic-frameworks", () => ({ composeStrategicLensBlock: () => "", pickFrameworks: () => [] }));
vi.mock("@/lib/ai/strategic-frameworks/record-lens-fire", () => ({ recordLensFire: () => undefined }));
vi.mock("@/lib/services/operator-state", () => ({
  currentOperatorState: async () => ({ confidence: 0 }),
  formatOperatorStateBlock: () => "",
}));
const recordTrace = vi.fn();
vi.mock("@/lib/ai/agent-trace", () => ({ mintTraceId: () => "t_side", recordTrace: (...a: unknown[]) => recordTrace(...a) }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));

import { POST } from "@/app/api/ai/side-pane-chat/route";
import { bannerUnbackedClaims } from "@/components/mastery/multi-turn-chat";
import { isVerifierRewritten } from "@/lib/ai/chat/fabrication-rewriter";
import { detectActionClaimsWithoutTools } from "@/lib/ai/chat/action-claim-detector";

const post = () =>
  POST(
    new Request("http://x/api/ai/side-pane-chat", {
      method: "POST",
      body: JSON.stringify({ page: "tasks", messages: [{ role: "user", content: "add a task to call the supplier" }] }),
    }),
  );

const traceMeta = () => (recordTrace.mock.calls[0][0] as { metadata: Record<string, unknown> }).metadata;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("side pane: unbacked action claims", () => {
  it("the route records a fabricated claim on the trace when a zero-tool reply says it acted", async () => {
    finishText = "I've added the task.";
    await post();
    await vi.waitFor(() => expect(recordTrace).toHaveBeenCalled());
    // Same unit the main chat logs (post-persist-verification `claims`): the detector's raw count.
    expect(traceMeta().fabricatedClaims).toBe(detectActionClaimsWithoutTools(finishText, []).length);
    expect(traceMeta().fabricatedClaims).toBeGreaterThan(0);
  });

  it("control: advice with no action claim records zero", async () => {
    finishText = "Open the mission and tap '+ task', then paste: Call the supplier.";
    await post();
    await vi.waitFor(() => expect(recordTrace).toHaveBeenCalled());
    expect(traceMeta().fabricatedClaims).toBe(0);
  });

  it("the client completion handler banners an unbacked claim before the turn is stored", () => {
    const stored = bannerUnbackedClaims("I've added it to your list.");
    expect(isVerifierRewritten(stored)).toBe(true);
    expect(stored.endsWith("I've added it to your list.")).toBe(true);
    expect(stored).not.toMatch(/fire the tool/);
  });

  it("control: advice passes through unchanged, and a bannered turn is not bannered twice", () => {
    const advice = "Tap '+ task' and paste: Call the supplier.";
    expect(bannerUnbackedClaims(advice)).toBe(advice);
    const once = bannerUnbackedClaims("I've added it to your list.");
    expect(bannerUnbackedClaims(once)).toBe(once);
  });
});
