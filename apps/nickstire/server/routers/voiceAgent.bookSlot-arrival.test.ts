/**
 * 2026-10-03 · bookSlot must not report success when nothing was saved.
 *
 * A live call at 12:33Z ran bookSlot, left NO expected_arrivals row and NO log
 * line: recordExpectedArrival returned null silently on a phone under 10 digits,
 * and bookSlot told the model success either way. These pin the three fixes:
 * caller-ID fallback, an honest not_recorded result, and the webhook injection.
 * DB-free (the arrivals service is mocked) so it runs in CI.
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
  vi.doMock("../services/expectedArrivals", () => ({ recordExpectedArrival }));
  const { voiceAgentRouter } = await import("./voiceAgent");
  return voiceAgentRouter.createCaller(createVoiceContext());
}

const base = { name: "Test Caller", service: "flat tire repair", preferredDay: "today" };

describe("bookSlot result is honest about the expected-arrival write", () => {
  afterEach(() => {
    vi.doUnmock("../services/expectedArrivals");
    vi.resetModules();
    recordExpectedArrival.mockReset();
  });

  it("recorded → success with walk-in guidance", async () => {
    recordExpectedArrival.mockResolvedValue({ id: 1, created: true });
    const res = await (await loadCaller()).bookSlot({ ...base, phone: "2165550101" });
    expect(res.success).toBe(true);
    expect(res.status).toBe("walk_in_guidance");
  });

  it("NOT recorded, SHORT number → success:false and the model re-confirms the number", async () => {
    recordExpectedArrival.mockResolvedValue(null);
    const res = await (await loadCaller()).bookSlot({ ...base, phone: "5550101" });
    expect(res.success).toBe(false);
    expect(res.status).toBe("not_recorded_phone");
    expect(res.message).toMatch(/10-digit/);
    // Still first-come guidance — the caller is never told they have a slot.
    expect(res.message).toMatch(/first come, first served/);
  });

  it("NOT recorded with a GOOD number (storage down) → no re-ask, no retry", async () => {
    recordExpectedArrival.mockResolvedValue(null);
    const res = await (await loadCaller()).bookSlot({ ...base, phone: "2165550101" });
    expect(res.success).toBe(false);
    expect(res.status).toBe("not_recorded");
    expect(res.message).not.toMatch(/10-digit/);
    expect(res.message).toMatch(/do not call bookSlot again/i);
  });

  it("a FULL spoken number wins over caller ID (they may give a different callback number)", async () => {
    recordExpectedArrival.mockResolvedValue({ id: 3, created: true });
    await (await loadCaller()).bookSlot({ ...base, phone: "216-555-0101", callerNumber: "+12165550199" });
    expect(recordExpectedArrival).toHaveBeenCalledWith(expect.objectContaining({ phone: "216-555-0101" }));
  });

  it("an unusable caller ID leaves the spoken value for the service to refuse", async () => {
    recordExpectedArrival.mockResolvedValue(null);
    await (await loadCaller()).bookSlot({ ...base, phone: "5550101", callerNumber: "anonymous" });
    expect(recordExpectedArrival).toHaveBeenCalledWith(expect.objectContaining({ phone: "5550101" }));
  });

  it("a short spoken number is filed under the injected caller ID", async () => {
    recordExpectedArrival.mockResolvedValue({ id: 2, created: true });
    await (await loadCaller()).bookSlot({ ...base, phone: "5550101", callerNumber: "+12165550199", callId: "call_x" });
    expect(recordExpectedArrival).toHaveBeenCalledWith(expect.objectContaining({ phone: "+12165550199", source: "voice", sourceRef: "call_x" }));
  });
});

describe("the webhook injects caller ID for bookSlot only", () => {
  it("source wires customerNumber into args.callerNumber, scoped to bookSlot", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(process.cwd(), "server/routes/webhooks/vapi.ts"), "utf8");
    expect(src).toContain('if (call.function.name === "bookSlot" && customerNumber) args.callerNumber = customerNumber;');
  });
});
