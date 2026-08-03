/**
 * Fail-loud guards — the failure DIRECTION of three guards that used to report
 * success while the underlying operation had failed, been rejected, or never run.
 *
 * Each test below pins a MECHANISM, not merely an exercise of the happy path:
 * every one of these defects passed the existing 4,500-test suite because the
 * broken path returned a success-shaped value.
 *
 * Test hygiene (serial single-fork process, per apps/nickstire/AGENTS.md S3):
 * every stub is restored in afterEach so leaks cannot surface in unrelated files.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { getBusinessHour } from "./lib/timezoneAssert";
import { makeRequest } from "./_core/map";

const realFetch = globalThis.fetch;
const realDTF = Intl.DateTimeFormat;

afterEach(() => {
  globalThis.fetch = realFetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Intl as any).DateTimeFormat = realDTF;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("getBusinessHour · quiet-hours guard must fail CLOSED", () => {
  it("returns an in-range hour for a normal clock", () => {
    const h = getBusinessHour(new Date("2026-08-03T18:30:00Z"));
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(23);
  });

  it("falls back to 0 when the hour part is unparseable — NOT NaN", () => {
    // THE defect. Two inlined copies used a bare parseInt. NaN fails every
    // comparison, so `NaN < 15 || NaN >= 18` is false and the guard OPENED,
    // letting outbound calls through at any hour.
    stubHourPart("not-a-number");
    const h = getBusinessHour();
    expect(Number.isNaN(h)).toBe(false);
    expect(h).toBe(0);
  });

  it("keeps every real call window CLOSED at the fallback value", () => {
    // 0 is only "fail closed" if it lands outside every window that uses it.
    // Asserting the windows directly means a future window that spans midnight
    // cannot silently turn the fallback into an open door.
    stubHourPart("not-a-number");
    const h = getBusinessHour();
    expect(h < 15 || h >= 18, "confirmationCalls window 15-18").toBe(true);
    expect(h < 10 || h >= 17, "voiceRecovery window 10-17").toBe(true);
    expect(h < 9 || h >= 19, "reviewRequests window 9-19").toBe(true);
    expect(h < 9 || h >= 18, "followupCadence window 9-18").toBe(true);
  });

  it("normalises the hour-24 rollover some engines emit", () => {
    stubHourPart("24");
    expect(getBusinessHour()).toBe(0);
  });
});

describe("makeRequest · a Google 200 body can still be a rejection", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key-not-real");
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key-not-real");
  });

  it("throws on REQUEST_DENIED delivered with HTTP 200", async () => {
    // THE defect. `!response.ok` cannot see this, so a denied credential flowed
    // on as an empty result and reviewMonitor reported "No reviews returned
    // from API" and SUCCEEDED.
    stubJsonResponse({ status: "REQUEST_DENIED", error_message: "The provided API key is invalid." });
    await expect(makeRequest("/maps/api/place/details/json")).rejects.toThrow(/REQUEST_DENIED/);
  });

  it("names the provider's own error text so the operator can act on it", async () => {
    stubJsonResponse({ status: "REQUEST_DENIED", error_message: "This API project is not authorized." });
    await expect(makeRequest("/maps/api/place/details/json")).rejects.toThrow(/not authorized/);
  });

  it("throws on OVER_QUERY_LIMIT too — quota exhaustion is not 'no data'", async () => {
    stubJsonResponse({ status: "OVER_QUERY_LIMIT" });
    await expect(makeRequest("/maps/api/place/details/json")).rejects.toThrow(/OVER_QUERY_LIMIT/);
  });

  it("does NOT throw on ZERO_RESULTS — a genuine empty answer must stay distinguishable", async () => {
    // The whole point of separating these: conflating them would trade a silent
    // failure for a noisy false alarm on every legitimately empty lookup.
    stubJsonResponse({ status: "ZERO_RESULTS", results: [] });
    await expect(makeRequest("/maps/api/place/textsearch/json")).resolves.toMatchObject({
      status: "ZERO_RESULTS",
    });
  });

  it("passes through OK unchanged", async () => {
    stubJsonResponse({ status: "OK", result: { rating: 4.9 } });
    await expect(makeRequest("/maps/api/place/details/json")).resolves.toMatchObject({
      result: { rating: 4.9 },
    });
  });

  it("passes through endpoints that carry no status envelope", async () => {
    // Not every Google surface uses the legacy `status` field. Enforcing it
    // unconditionally would break those callers.
    stubJsonResponse({ someOtherShape: true });
    await expect(makeRequest("/maps/api/whatever")).resolves.toMatchObject({ someOtherShape: true });
  });
});

// ─── helpers ────────────────────────────────────────────────────────────────

function stubJsonResponse(body: unknown): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as typeof fetch;
}

/** Force Intl to yield a specific `hour` part so the parse path is testable. */
function stubHourPart(value: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Intl as any).DateTimeFormat = function () {
    return { formatToParts: () => [{ type: "hour", value }] };
  };
}

describe("invoice_paid · every emitter must dispatch DOLLARS, not cents", () => {
  // THE REGRESSION THIS EXISTS FOR: removing a double `/100` in liveFeed was
  // justified by grepping emitters for `/ 100` — a search that by construction
  // can only return emitters which DIVIDE. snapFinanceSync passed raw
  // `amountCents` and so was invisible to it, which would have made a $250
  // financing approval add 25,000 to daily revenue and announce "$25000".
  //
  // A source scan is the right shape here: the bus payload is loosely typed
  // (`data: any` in the bridge map), so nothing else can catch a new producer
  // that passes the wrong unit.
  it("no dispatch site passes a *Cents identifier as totalAmount", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    const walk = (dir: string, acc: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, acc);
        else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) acc.push(full);
      }
      return acc;
    };

    const offenders: string[] = [];
    for (const file of walk("server")) {
      const src = readFileSync(file, "utf8");
      // Scope the scan to the dispatch CALL, not the whole file. The same file
      // legitimately writes `totalAmount: amountCents` into the invoices row —
      // the DB column stores cents and must keep doing so. Only the value that
      // crosses the event bus is required to be dollars.
      for (const call of src.matchAll(/dispatch\("invoice_paid",\s*\{/g)) {
        const block = src.slice(call.index, call.index + 600);
        const end = block.indexOf("});");
        const args = end === -1 ? block : block.slice(0, end);
        for (const m of args.matchAll(/totalAmount:\s*([A-Za-z_$][\w$.]*)\s*,/g)) {
          if (/cents$/i.test(m[1])) offenders.push(`${file}: totalAmount: ${m[1]}`);
        }
      }
    }

    expect(offenders, `emitters passing cents as dollars:\n${offenders.join("\n")}`).toEqual([]);
  });
});
