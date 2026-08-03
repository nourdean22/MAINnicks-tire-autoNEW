/**
 * The reviews cron must FAIL LOUD.
 *
 * `fetchAndStoreReviews` throws when GOOGLE_PLACE_ID / GOOGLE_PLACES_API_KEY are
 * unset, and the Places API can return REQUEST_DENIED inside an HTTP 200 body.
 * Both must reach cronHandler so a FAILED CronJobLog row lands on /system/crons.
 *
 * A `catch` in the route would recreate exactly the defect the nickstire side
 * spent #1298 removing: reviewMonitor returned "No reviews returned from API"
 * and SUCCEEDED while the credential was denied, which is why review ingestion
 * sat dead long enough for five PRs to be built around the missing evidence.
 *
 * These assert the ROUTE's error behaviour, not the fetcher's — the fetcher is
 * covered by its own tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchAndStoreReviews = vi.fn();

vi.mock("@/lib/integrations/google-reviews", () => ({
  fetchAndStoreReviews: (...a: unknown[]) => fetchAndStoreReviews(...a),
}));

// cronHandler pulls in DB + settings; stub it to the identity wrapper so these
// tests exercise the ROUTE body rather than the framework around it.
vi.mock("@/lib/utils/http", () => ({
  cronHandler: (h: (req: Request, ctx: unknown) => Promise<unknown>) => h,
}));

vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

async function loadRoute() {
  vi.resetModules();
  return await import("@/app/api/cron/ingest-reviews/route");
}

beforeEach(() => fetchAndStoreReviews.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("ingest-reviews cron · failures must propagate", () => {
  it("does NOT swallow a missing-credential throw", async () => {
    fetchAndStoreReviews.mockRejectedValueOnce(
      new Error("GOOGLE_PLACE_ID and GOOGLE_PLACES_API_KEY must be set"),
    );
    const { GET } = await loadRoute();
    await expect(GET(new Request("http://x/api/cron/ingest-reviews"), {} as never))
      .rejects.toThrow(/must be set/);
  });

  it("does NOT swallow a Places rejection", async () => {
    // REQUEST_DENIED arrives inside an HTTP 200 body; the shared client turns it
    // into a throw. The route must let that reach the cron log.
    fetchAndStoreReviews.mockRejectedValueOnce(new Error("Places API rejected: REQUEST_DENIED"));
    const { GET } = await loadRoute();
    await expect(GET(new Request("http://x/api/cron/ingest-reviews"), {} as never))
      .rejects.toThrow(/REQUEST_DENIED/);
  });

  it("returns the fetcher's counts on success", async () => {
    fetchAndStoreReviews.mockResolvedValueOnce({ fetched: 5, newCount: 2 });
    const { GET } = await loadRoute();
    const out = await GET(new Request("http://x/api/cron/ingest-reviews"), {} as never);
    expect(out).toEqual({ fetched: 5, newCount: 2 });
  });

  it("reports a genuine zero as success, not as an error", async () => {
    // Zero NEW reviews is a real answer — the shop simply had none today. Only
    // a rejection is a failure. Conflating them would trade a silent failure
    // for a nightly false alarm.
    fetchAndStoreReviews.mockResolvedValueOnce({ fetched: 5, newCount: 0 });
    const { GET } = await loadRoute();
    await expect(GET(new Request("http://x/api/cron/ingest-reviews"), {} as never))
      .resolves.toEqual({ fetched: 5, newCount: 0 });
  });
});
