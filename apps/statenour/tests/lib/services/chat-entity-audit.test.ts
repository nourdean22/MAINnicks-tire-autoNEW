/**
 * Chat Route Actor Context / Entity Audit tests · Track B.3
 *
 * Verifies that POST /api/ai/chat wraps the execution in withActor("nick")
 * to ensure AI changes are properly logged in the audit trail.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  checkAiRateLimit: vi.fn(() => null),
  loadFeatureFlagOverrides: vi.fn(),
  withActor: vi.fn((actor: string, fn: () => any) => fn()),
}));

vi.mock("@/lib/auth-guard", () => ({
  requireSession: mocks.requireSession,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkAiRateLimit: mocks.checkAiRateLimit,
}));

vi.mock("@/lib/feature-flags", () => ({
  loadFeatureFlagOverrides: mocks.loadFeatureFlagOverrides,
}));

vi.mock("@/lib/db/actor", () => ({
  withActor: mocks.withActor,
}));

// Mock the chatPostInner dependencies to avoid running the heavy AI streaming setup
vi.mock("@/lib/ai/chat/timing", () => ({
  createStageTracker: vi.fn(() => ({
    start: vi.fn(() => ({ end: vi.fn() })),
  })),
  formatStageLog: vi.fn(),
}));

vi.mock("@/lib/ai/chat/gate", () => ({
  runGate: vi.fn().mockResolvedValue({ kind: "block", response: new Response("blocked") }),
}));

import { POST } from "@/app/api/ai/chat/route";

describe("POST /api/ai/chat actor context wrapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("authenticates, rate-limits, and wraps the execution inside withActor('nick')", async () => {
    const mockRequest = new Request("http://localhost/api/ai/chat", {
      method: "POST",
    });

    mocks.requireSession.mockResolvedValueOnce({});
    mocks.loadFeatureFlagOverrides.mockResolvedValueOnce(undefined);

    const response = await POST(mockRequest);

    // Verify authentication & rate-limiting gates ran first
    expect(mocks.requireSession).toHaveBeenCalledWith(mockRequest);
    expect(mocks.checkAiRateLimit).toHaveBeenCalledWith(mockRequest);

    // Verify withActor("nick") was triggered
    expect(mocks.withActor).toHaveBeenCalledWith("nick", expect.any(Function));

    expect(response).toBeInstanceOf(Response);
    expect(await response.text()).toBe("blocked");
  });
});
