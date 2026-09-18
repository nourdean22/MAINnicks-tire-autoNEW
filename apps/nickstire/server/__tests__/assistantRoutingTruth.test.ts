/**
 * Does the number callers dial answer with the assistant we push config to?
 *
 * Every other resolver in `services/vapi.ts` answers "which assistant do we
 * WRITE to". None answered "which one ANSWERS", so a push could be perfectly
 * deterministic and still land on an assistant nobody reaches. Recorded as a
 * blocker on 2026-09-18; this is the instrument that closes it.
 *
 * THE POINT OF THESE TESTS IS THE UNKNOWN STATE. A binding we could not read
 * must never render as a verified one, and there are several legitimate ways
 * for the question to have no yes/no answer — a squad, an assistant-request
 * server URL, a number missing from the account. Calling any of those a
 * "mismatch" would invent an alarm; calling any of them a "match" would invent
 * a reassurance. Both are worse than saying we do not know.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAssistantRoutingTruth } from "../services/vapi";

const NUMBER = "+12164249249";
const PINNED = "150fe622-0b9f-4b03-b8c7-3063812717ae";
const OTHER = "afcad79e-ec3a-0000-0000-000000000000";

const ORIGINAL_KEY = process.env.VAPI_API_KEY;
const ORIGINAL_PIN = process.env.VAPI_RECEPTIONIST_ASSISTANT_ID;

/** Stub only the phone-number fetch; everything else stays real. */
function stubPhoneNumbers(body: unknown, ok = true, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch);
}

beforeEach(() => {
  process.env.VAPI_API_KEY = "test-key";
  process.env.VAPI_RECEPTIONIST_ASSISTANT_ID = PINNED;
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Delete first, then restore — `if (orig) env.X = orig` leaks when orig was
  // undefined, and assigning undefined stores the literal string "undefined".
  delete process.env.VAPI_API_KEY;
  delete process.env.VAPI_RECEPTIONIST_ASSISTANT_ID;
  if (ORIGINAL_KEY !== undefined) process.env.VAPI_API_KEY = ORIGINAL_KEY;
  if (ORIGINAL_PIN !== undefined) process.env.VAPI_RECEPTIONIST_ASSISTANT_ID = ORIGINAL_PIN;
});

describe("the question has a real answer", () => {
  it("MATCH when the line answers with the pinned edit target", async () => {
    stubPhoneNumbers([{ id: "pn_1", number: NUMBER, assistantId: PINNED }]);
    const r = await getAssistantRoutingTruth();
    expect(r.state).toBe("match");
    expect(r.answeringAssistantId).toBe(PINNED);
    expect(r.editTargetAssistantId).toBe(PINNED);
  });

  it("MISMATCH when the line answers with a different assistant", async () => {
    // This is the failure the whole instrument exists to catch: pushes land
    // somewhere real, and no caller ever reaches it.
    stubPhoneNumbers([{ id: "pn_1", number: NUMBER, assistantId: OTHER }]);
    const r = await getAssistantRoutingTruth();
    expect(r.state).toBe("mismatch");
    expect(r.detail).toContain(OTHER);
    expect(r.detail).toContain(PINNED);
  });

  it("ignores other numbers on the account", async () => {
    stubPhoneNumbers([
      { id: "pn_x", number: "+15550000000", assistantId: OTHER },
      { id: "pn_1", number: NUMBER, assistantId: PINNED },
    ]);
    expect((await getAssistantRoutingTruth()).state).toBe("match");
  });
});

describe("UNKNOWN is never dressed up as either answer", () => {
  it("a squad or assistant-request URL leaves no id, and that is not a mismatch", async () => {
    stubPhoneNumbers([{ id: "pn_1", number: NUMBER, assistantId: null }]);
    const r = await getAssistantRoutingTruth();
    expect(r.state).toBe("unknown");
    expect(r.answeringAssistantId).toBeNull();
  });

  it("a non-OK VAPI response is unknown, not match", async () => {
    stubPhoneNumbers({}, false, 503);
    const r = await getAssistantRoutingTruth();
    expect(r.state).toBe("unknown");
    expect(r.detail).toContain("503");
  });

  it("a thrown fetch is unknown, not match", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch);
    const r = await getAssistantRoutingTruth();
    expect(r.state).toBe("unknown");
    expect(r.detail).toContain("ECONNRESET");
  });

  it("an unexpected payload shape is unknown", async () => {
    stubPhoneNumbers({ notAnArray: true });
    expect((await getAssistantRoutingTruth()).state).toBe("unknown");
  });

  it("the number missing from the account is unknown", async () => {
    stubPhoneNumbers([{ id: "pn_x", number: "+15550000000", assistantId: PINNED }]);
    const r = await getAssistantRoutingTruth();
    expect(r.state).toBe("unknown");
    expect(r.answeringAssistantId).toBeNull();
  });

  it("no API key is unknown, and says so rather than staying silent", async () => {
    delete process.env.VAPI_API_KEY;
    const r = await getAssistantRoutingTruth();
    expect(r.state).toBe("unknown");
    expect(r.detail).toContain("not a clean bill of health");
  });

  it("an unset pin is unknown even when the line HAS an assistant", async () => {
    // We know what answers; we have nothing to compare it to. That is not a
    // match, and it is not a mismatch.
    delete process.env.VAPI_RECEPTIONIST_ASSISTANT_ID;
    stubPhoneNumbers([{ id: "pn_1", number: NUMBER, assistantId: PINNED }]);
    const r = await getAssistantRoutingTruth();
    expect(r.state).toBe("unknown");
    expect(r.answeringAssistantId).toBe(PINNED);
    expect(r.editTargetAssistantId).toBeNull();
  });
});

describe("the contract holds regardless of state", () => {
  it("POSITIVE CONTROL: all three states are reachable", async () => {
    // Without this, a function hardcoded to "unknown" would satisfy every
    // fail-closed assertion above and look like a careful instrument.
    stubPhoneNumbers([{ id: "pn_1", number: NUMBER, assistantId: PINNED }]);
    const a = (await getAssistantRoutingTruth()).state;
    vi.unstubAllGlobals();
    stubPhoneNumbers([{ id: "pn_1", number: NUMBER, assistantId: OTHER }]);
    const b = (await getAssistantRoutingTruth()).state;
    vi.unstubAllGlobals();
    stubPhoneNumbers([{ id: "pn_1", number: NUMBER, assistantId: null }]);
    const c = (await getAssistantRoutingTruth()).state;
    expect([a, b, c].sort()).toEqual(["match", "mismatch", "unknown"]);
  });

  it("detail is never blank — an operator always gets a sentence", async () => {
    for (const body of [
      [{ id: "pn_1", number: NUMBER, assistantId: PINNED }],
      [{ id: "pn_1", number: NUMBER, assistantId: OTHER }],
      [{ id: "pn_1", number: NUMBER, assistantId: null }],
      [],
    ]) {
      vi.unstubAllGlobals();
      stubPhoneNumbers(body);
      const r = await getAssistantRoutingTruth();
      expect(r.detail.trim().length).toBeGreaterThan(20);
    }
  });

  it("is total — a hostile payload never throws", async () => {
    for (const body of [null, "string", 42, [null], [{ number: NUMBER }]]) {
      vi.unstubAllGlobals();
      stubPhoneNumbers(body);
      await expect(getAssistantRoutingTruth()).resolves.toBeDefined();
    }
  });
});
