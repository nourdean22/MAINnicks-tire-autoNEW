/**
 * callNickstire carries the caller's idempotency key on the wire (07-SN-04).
 *
 * The Telegram approve paths pass the ActionReceipt id so a replayed send
 * (retry, redelivered update, a claim that crashed mid-send) can be deduped by
 * the receiver. fetch is stubbed: nothing leaves the process.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  vi.stubEnv("BRIDGE_API_KEY", "test-bridge-key");
  vi.stubEnv("NICKSTIRE_URL", "https://nickstire.invalid");
  const fetch = vi.fn(
    async (..._a: unknown[]) =>
      new Response(JSON.stringify({ result: { data: { json: { ok: true } } } }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetch);
  return { fetch };
});

import { callNickstire } from "@/lib/ai/agent-actions/shop-actions";

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
beforeEach(() => h.fetch.mockClear());

function sentHeaders(): Record<string, string> {
  const init = h.fetch.mock.calls[0]?.[1] as { headers?: Record<string, string> } | undefined;
  return init?.headers ?? {};
}

describe("callNickstire idempotency key", () => {
  it("a send with a key puts it on the Idempotency-Key header", async () => {
    await callNickstire("smsBot.send", { phone: "+15550001111", message: "hi" }, { idempotencyKey: "rcpt_1" });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(sentHeaders()["Idempotency-Key"]).toBe("rcpt_1");
  });

  it("positive control: without a key the header is absent and the call still goes out", async () => {
    await callNickstire("smsBot.send", { phone: "+15550001111", message: "hi" });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(sentHeaders()).not.toHaveProperty("Idempotency-Key");
    expect(String(h.fetch.mock.calls[0]?.[0])).toBe("https://nickstire.invalid/api/trpc/smsBot.send");
  });
});
