/**
 * "Push Latest Config" (updateAssistant) must never re-route live transfers.
 *
 * The transfer destination (the manager's cell) and the warm-transfer plan
 * (warm-transfer-experimental + fallbackPlan + dialTimeout 25, applied
 * 2026-09-21 by scripts/vapi-warm-transfer-fallback.ts) live ONLY in Vapi. The
 * code holds a placeholder shop landline and the legacy say-message plan.
 * updateAssistant reads the live assistant first and carries both across
 * (preserveLiveTransferDestinations). It used to treat that read as
 * best-effort: a failed or non-OK read fell through and PATCHed the code
 * defaults — silently sending every transfer to the landline and dropping the
 * fallback that returns an unanswered caller to the assistant. A push the
 * operator can simply retry is the cheaper failure, so a failed read now
 * refuses the push.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { updateAssistant } from "./services/vapi";

const LIVE_PLAN = {
  mode: "warm-transfer-experimental",
  message: "You've got a customer holding on the Nick's Tire and Auto line. Connecting you now.",
  sipVerb: "dial",
  dialTimeout: 25,
  fallbackPlan: { message: "Sorry about that — nobody could grab the line.", endCallEnabled: false },
};
const LIVE_ASSISTANT = {
  model: {
    tools: [
      { type: "transferCall", destinations: [{ type: "number", number: "+12165550199", message: "Connecting you to the shop now.", transferPlan: LIVE_PLAN }] },
    ],
  },
};

type Call = { url: string; method: string; body?: string };

function stubVapi(get: () => Promise<Response>) {
  const calls: Call[] = [];
  vi.stubEnv("VAPI_API_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ url: String(url), method, body: typeof init.body === "string" ? init.body : undefined });
    if (method === "GET") return get();
    return new Response("{}", { status: 200 });
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("updateAssistant fails closed when it cannot read the live assistant", () => {
  it("a non-OK read refuses the push — no PATCH is sent", async () => {
    const calls = stubVapi(async () => new Response("upstream down", { status: 503 }));
    const res = await updateAssistant("asst-1", "https://nickstire.org/api/webhooks/vapi");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/refus/i);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("a read that throws (timeout, network) refuses the push — no PATCH is sent", async () => {
    const calls = stubVapi(async () => { throw new Error("The operation was aborted due to timeout"); });
    const res = await updateAssistant("asst-1", "https://nickstire.org/api/webhooks/vapi");
    expect(res.success).toBe(false);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("POSITIVE CONTROL: a good read pushes, carrying the live number AND the whole live transfer plan", async () => {
    const calls = stubVapi(async () => new Response(JSON.stringify(LIVE_ASSISTANT), { status: 200 }));
    const res = await updateAssistant("asst-1", "https://nickstire.org/api/webhooks/vapi");
    expect(res.success).toBe(true);
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch).toBeTruthy();
    const sent = JSON.parse(patch!.body!);
    const transfer = sent.model.tools.find((t: { type?: string }) => t.type === "transferCall");
    expect(transfer.destinations[0].number).toBe("+12165550199");
    expect(transfer.destinations[0].transferPlan).toEqual(LIVE_PLAN);
  });
});
