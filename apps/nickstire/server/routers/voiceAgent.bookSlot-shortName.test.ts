/**
 * bookSlot with a one-letter name returns a normal tool result, not a thrown error.
 *
 * The input check used to throw for a name under two letters. The webhook turns
 * a throw into "Tool execution failed" (routes/webhooks/vapi.ts), which the caller
 * hears. The model should ask once for the full name instead, and nothing is
 * recorded until it has one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const recordExpectedArrival = vi.fn();

function createVoiceContext(): TrpcContext {
  return {
    user: null,
    isVoiceAgentInternal: true,
    req: { protocol: "https", headers: {} } as any,
    res: { clearCookie: () => {} } as any,
  };
}

async function loadCaller() {
  vi.resetModules();
  vi.doMock("../services/expectedArrivals", async (orig) => ({
    ...(await orig<typeof import("../services/expectedArrivals")>()),
    recordExpectedArrival,
  }));
  const { voiceAgentRouter } = await import("./voiceAgent");
  return voiceAgentRouter.createCaller(createVoiceContext());
}

// A LATER day: coming today texts the shop with whatever name it has (voiceAgent.headsUp.test.ts).
const base = { phone: "2165550101", service: "flat tire repair", preferredDay: "tomorrow" };

describe("bookSlot with an incomplete name", () => {
  afterEach(() => {
    vi.doUnmock("../services/expectedArrivals");
    vi.resetModules();
    recordExpectedArrival.mockReset();
  });

  it("answers a normal result that asks for the full name, and records nothing", async () => {
    const res = await (await loadCaller()).bookSlot({ ...base, name: "A" });
    expect(res.success).toBe(false);
    expect(res.status).toBe("name_incomplete");
    expect(res.message).toMatch(/full name/);
    expect(res.message).toMatch(/first come, first served/);
    expect(recordExpectedArrival).not.toHaveBeenCalled();
  });

  it("treats a blank name as incomplete too", async () => {
    const res = await (await loadCaller()).bookSlot({ ...base, name: "   " });
    expect(res.status).toBe("name_incomplete");
    expect(recordExpectedArrival).not.toHaveBeenCalled();
  });
});
