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

  it("the tRPC fetch passes a bounded signal", () => {
    expect(main).toContain("signal: boundedSignal(init?.signal)");
  });

  it("the ceiling is a real timeout, not a comment", () => {
    expect(main).toContain("AbortSignal.timeout(REQUEST_CEILING_MS)");
  });

  it("cancellation survives when AbortSignal.any is unavailable", () => {
    // The fallback must forward the CALLER's signal. Returning the timeout
    // instead would silently drop tRPC's unmount cancellation on older Safari.
    const fn = main.slice(main.indexOf("function boundedSignal"), main.indexOf("const trpcClient"));
    expect(fn).toContain("anyOf([existing, timeout]) : existing");
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
