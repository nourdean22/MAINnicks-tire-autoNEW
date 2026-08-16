/**
 * "Unknown" must never render as "empty", and no state may last forever.
 *
 * Three defects, one theme — a surface stating something it had not established:
 *   1. A stalled request had no ceiling, so isLoading stayed true and the
 *      spinner was permanent. The transport, not the component, was the cause.
 *   2. An offline/paused query leaves isError AND isLoading false with data
 *      undefined, so the feed fell through to "Make sure Instagram credentials
 *      are set" — a diagnosis of a read that never happened.
 *   3. getContentClusters did not destructure isError at all, so a failed read
 *      rendered as "No prominent themes found right now."
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readStatus, readStatusOfList, unavailableCopy } from "../client/src/lib/queryState";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("readStatus classifies the state react-query cannot express with isLoading", () => {
  it("PAUSED (offline) is unavailable, NOT empty — the whole reason this exists", () => {
    // The exact shape react-query leaves behind when the browser is offline.
    const paused = { isError: false, isLoading: false, isPending: true, fetchStatus: "paused" as const, data: undefined };
    const s = readStatusOfList(paused);
    expect(s.state).toBe("unavailable");
    expect(s.reason).toBe("not_attempted");
  });

  it("an ERROR is unavailable and distinguishable from a paused read", () => {
    const s = readStatusOfList({ isError: true, isLoading: false, data: undefined });
    expect(s.state).toBe("unavailable");
    expect(s.reason).toBe("error");
  });

  it("a genuinely fetching query is loading", () => {
    expect(readStatusOfList({ isError: false, isLoading: true, fetchStatus: "fetching", data: undefined }).state)
      .toBe("loading");
  });

  it("a SUCCESSFUL read of zero rows is empty — a real zero must survive", () => {
    const s = readStatusOfList({ isError: false, isLoading: false, fetchStatus: "idle", data: [] });
    expect(s.state).toBe("empty");
  });

  it("a successful read with rows is ready", () => {
    expect(readStatusOfList({ isError: false, isLoading: false, fetchStatus: "idle", data: [{ id: 1 }] }).state)
      .toBe("ready");
  });

  it("emptiness is domain-defined, so a nested shape is not misread as empty", () => {
    const withClusters = { isError: false, isLoading: false, fetchStatus: "idle" as const, data: { clusters: [{ label: "brakes" }] } };
    const noClusters = { isError: false, isLoading: false, fetchStatus: "idle" as const, data: { clusters: [] } };
    const isEmpty = (d: unknown) => {
      const c = (d as { clusters?: unknown[] }).clusters;
      return Array.isArray(c) && c.length === 0;
    };
    expect(readStatus(withClusters, isEmpty).state).toBe("ready");
    expect(readStatus(noClusters, isEmpty).state).toBe("empty");
  });

  it("copy for a not-attempted read never diagnoses a cause it has not established", () => {
    expect(unavailableCopy("not_attempted")).not.toMatch(/credential/i);
    expect(unavailableCopy("not_attempted")).toMatch(/unknown, not empty/);
    expect(unavailableCopy("error")).toMatch(/unknown, not empty/);
  });
});

describe("the transport can no longer hang forever", () => {
  const main = read("client/src/main.tsx");
  const fn = main.slice(main.indexOf("function boundedSignal"), main.indexOf("const UNBATCHED"));

  it("the tRPC fetch composes a bounded signal, listed AFTER the spread", () => {
    expect(main).toContain("signal: boundedSignal(init?.signal)");
  });

  it("does NOT clear the timer when the fetch promise settles", () => {
    // Self-audit finding: `fetch` resolves at response HEADERS, and tRPC then
    // reads the body with nothing watching. Clearing on settle left a
    // stalled-body response unbounded — the exact hang class this exists for.
    // Behavioural coverage lives in server/requestCeiling.test.ts.
    expect(main).not.toContain(".finally(done)");
  });

  it("bounds the retry count, because a per-attempt ceiling is not a bound", () => {
    // query-core defaults to 3 retries and its `failed` transition leaves
    // fetchStatus === "fetching", so the spinner survived 4 x 120s + backoff.
    expect(main).toContain("retry: 1");
  });

  it("does NOT call AbortSignal.timeout — it would throw where that API is absent", () => {
    // Review caught this: an unconditional AbortSignal.timeout meant EVERY tRPC
    // call threw synchronously on an iOS/Safari build without it — breaking the
    // whole admin far worse than the stalled spinner being fixed.
    //
    // Asserted against the function BODY, not the whole file: `fn` is sliced from
    // `function boundedSignal`, which sits after the JSDoc, so the doc comment
    // above it is free to NAME the two APIs it is warning against. Checking the
    // file would match that warning and fail — as it did on first run.
    expect(fn).not.toContain("AbortSignal.timeout");
    expect(fn).not.toContain("AbortSignal.any");
  });

  it("composes manually, so the ceiling applies on EVERY browser", () => {
    // The previous fallback forwarded only the caller's signal, silently
    // dropping the ceiling wherever AbortSignal.any was missing.
    expect(fn).toContain("new AbortController()");
    expect(fn).toContain("setTimeout(");
    expect(fn).toContain("REQUEST_CEILING_MS");
  });

  it("still propagates tRPC's cancellation, including an already-aborted signal", () => {
    expect(fn).toContain("existing.aborted");
    expect(fn).toContain('existing.addEventListener("abort"');
  });
});

describe("storage copy names the delivery path instead of asserting CloudFront", () => {
  it("health reports WHICH permanent-URL mode is in use", () => {
    expect(read("server/routers/instagramAdmin.ts")).toContain("cdn: !!process.env.CLOUDFRONT_DOMAIN");
  });

  it("Settings no longer claims CloudFront is configured when it is absent", () => {
    // Making `configured` true on S3 alone left this consumer swapping one false
    // health report for another — caught in review.
    const settings = read("client/src/pages/admin/instagram/Settings.tsx");
    expect(settings).not.toContain("S3 and CloudFront are configured");
    expect(settings).not.toContain("S3_BUCKET and CLOUDFRONT_DOMAIN must both be configured");
    expect(settings).toContain("health.data?.storage?.cdn");
    expect(settings).toMatch(/served through the app from S3/);
  });
});

describe("Community states what it actually read", () => {
  const inbox = read("client/src/pages/admin/instagram/Inbox.tsx");

  it("no longer blames Instagram credentials for a read that never happened", () => {
    expect(inbox).not.toContain("Make sure Instagram credentials are set");
  });

  it("the feed distinguishes unavailable from verified empty", () => {
    expect(inbox).toContain('feedStatus.state === "unavailable"');
    expect(inbox).toContain("the cache was read and is empty");
  });

  it("the cluster panel has an unavailable branch at all — it previously had none", () => {
    expect(inbox).toContain('optStatus.state === "unavailable"');
    // The confident-empty string may remain, but only AFTER the unavailable
    // branch. Both anchors are JSX-shaped so they cannot match the explanatory
    // comments in this file or in Inbox.tsx — the mistake this assertion caught
    // on its first run.
    const unavailableAt = inbox.indexOf(') : optStatus.state === "unavailable" ? (');
    const emptyAt = inbox.indexOf(">No prominent themes found right now.</div>");
    expect(unavailableAt, "the unavailable JSX branch is missing").toBeGreaterThan(-1);
    expect(emptyAt, "the verified-empty JSX is missing").toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(unavailableAt);
  });
});

describe("a scan that never ran is not a clean database", () => {
  const panel = read("client/src/pages/admin/settings/DatabaseHygienePanel.tsx");

  it("bails BEFORE the counts that fabricate the all-clear", () => {
    // `data?.fake.length ?? 0` summed three short-circuited zeros into
    // totalCount === 0, which renders a green check and "Database is perfectly
    // clean!". The unavailable guard must precede that arithmetic, not follow it.
    const guardAt = panel.indexOf('if (scanStatus.state === "unavailable")');
    const countAt = panel.indexOf("const fakeCount = data?.fake.length ?? 0;");
    expect(guardAt, "the unavailable guard is missing").toBeGreaterThan(-1);
    expect(countAt, "the count line moved — re-anchor this test").toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(countAt);
  });

  it("the all-clear claim is still reachable for a REAL clean scan", () => {
    // The fix must not delete the honest success state: a scan that ran and
    // found nothing is a true zero and should still say so.
    expect(panel).toContain("Database is perfectly clean!");
    expect(panel).toContain("totalCount === 0");
  });

  it("says unknown, not clean, and offers a retry", () => {
    expect(panel).toMatch(/unknown<\/strong>, not clean/);
    expect(panel).toContain("Retry scan");
  });
});

describe("storage health reads the storage module's own authority", () => {
  it("neither health surface computes permanence from CLOUDFRONT_DOMAIN any more", () => {
    // This was the inversion: usesProxiedReads() is (S3_ENDPOINT && !CLOUDFRONT),
    // so !!CLOUDFRONT_DOMAIN reported "Ephemeral Only" exactly when permanent
    // proxied URLs were serving.
    for (const f of ["server/routers/instagramAdmin.ts", "server/services/socialDeliveryIssues.ts"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/permanentUrls:\s*!!process\.env\.CLOUDFRONT_DOMAIN/);
      expect(src, f).toContain("servesPermanentUrls()");
    }
  });

  it("the health card no longer requires CloudFront to call storage configured", () => {
    const src = read("server/routers/instagramAdmin.ts");
    expect(src).not.toMatch(/configured:\s*!!process\.env\.S3_BUCKET\s*&&\s*!!process\.env\.CLOUDFRONT_DOMAIN/);
    expect(src).toContain("configured: durableStorageConfigured()");
  });

  it("servesPermanentUrls mirrors storagePut's two permanent branches", () => {
    const src = read("server/storage.ts");
    const fn = src.slice(src.indexOf("export function servesPermanentUrls"));
    expect(fn).toContain("!!process.env.CLOUDFRONT_DOMAIN || usesProxiedReads()");
  });
});
