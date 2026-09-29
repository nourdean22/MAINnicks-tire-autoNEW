/**
 * ADR-0019 (sender half): a keyed evidence batch carries the Idempotency-Key
 * header, and StateNour's `{duplicate:true}` 200 counts as delivered.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { postToEvidenceLedger } from "./evidenceLedger";

function stubFetch(body: unknown = { ok: true }) {
  const fetchSpy = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

const headersOf = (spy: ReturnType<typeof stubFetch>) =>
  (spy.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;

describe("postToEvidenceLedger idempotency key", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends the key as the Idempotency-Key header when given", async () => {
    vi.stubEnv("STATENOUR_SYNC_URL", "https://statenour.example/");
    vi.stubEnv("STATENOUR_SYNC_KEY", "k-canary");
    const spy = stubFetch({ ok: true, duplicate: true });
    const ok = await postToEvidenceLedger({ events: [] }, { idempotencyKey: "v1:experiment.verdict:e:abc:no_signal" });
    expect(ok).toBe(true);
    expect(spy.mock.calls[0][0]).toBe("https://statenour.example/api/sync/evidence");
    expect(headersOf(spy)["Idempotency-Key"]).toBe("v1:experiment.verdict:e:abc:no_signal");
    expect(headersOf(spy)["x-sync-key"]).toBe("k-canary");
  });

  it("sends no key header when none (or null) is given — the legacy path", async () => {
    vi.stubEnv("STATENOUR_SYNC_URL", "https://statenour.example");
    vi.stubEnv("STATENOUR_SYNC_KEY", "k");
    const spy = stubFetch();
    await postToEvidenceLedger({ events: [] });
    await postToEvidenceLedger({ events: [] }, { idempotencyKey: null });
    for (const call of spy.mock.calls) {
      expect((call as unknown as [string, RequestInit])[1].headers).not.toHaveProperty("Idempotency-Key");
    }
  });
});
