import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchQuoteCents } from "@/lib/services/market-quote";

type FakeRes = { ok: boolean; json?: () => Promise<unknown>; text?: () => Promise<string> };

function mockFetch(handler: (url: string) => FakeRes) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => handler(String(url)) as unknown as Response),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchQuoteCents", () => {
  it("returns cents from Yahoo for an equity", async () => {
    mockFetch((url) =>
      url.includes("finance.yahoo.com")
        ? { ok: true, json: async () => ({ chart: { result: [{ meta: { regularMarketPrice: 297.34 } }] } }) }
        : { ok: false },
    );
    const q = await fetchQuoteCents("AAPL");
    expect(q.priceCents).toBe(29734);
    expect(q.source).toBe("yahoo:AAPL");
  });

  it("falls back to Stooq when Yahoo fails", async () => {
    mockFetch((url) => {
      if (url.includes("finance.yahoo.com")) return { ok: false };
      if (url.includes("stooq.com")) {
        return {
          ok: true,
          text: async () =>
            "Symbol,Date,Time,Open,High,Low,Close,Volume\nAAPL.US,2026-06-18,22:00:00,290,300,289,295.5,1000000\n",
        };
      }
      return { ok: false };
    });
    const q = await fetchQuoteCents("AAPL");
    expect(q.priceCents).toBe(29550);
    expect(q.source).toContain("stooq");
  });

  it("returns null when every source fails", async () => {
    mockFetch(() => ({ ok: false }));
    const q = await fetchQuoteCents("ZZZZ");
    expect(q.priceCents).toBeNull();
    expect(q.source).toBeNull();
  });

  it("returns null for an empty symbol without fetching", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const q = await fetchQuoteCents("   ");
    expect(q.priceCents).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
