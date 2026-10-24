/**
 * readState: the one shared read of a query's honest state (truth sweep 2026-10-23, acceptance 2).
 *
 * THE DEFECT. A PWA with no connection leaves a tRPC query PAUSED: no data, no error, and
 * isLoading false (v5 isLoading is "fetching and pending"). Every panel that read `data` and
 * `isError` and nothing else rendered that as empty, zero, idle or hidden. 0 readers of
 * `fetchStatus` existed in the app. These cases pin the table; each component test pins that the
 * panel reads it.
 */
import { describe, expect, it } from "vitest";
import { errorCopy, isRetrying, offlineCopy, readState, staleCopy } from "@/lib/query-state";

describe("readState", () => {
  it("data in hand is ready, even when a refetch paused (the blank is worse than the cache)", () => {
    expect(readState({ data: [], isError: false, fetchStatus: "idle" })).toBe("ready");
    expect(readState({ data: { a: 1 }, isError: false, fetchStatus: "paused" })).toBe("ready");
  });

  it("data in hand after a FAILED refresh is stale, never ready: the data stays, the failure is said", () => {
    expect(readState({ data: { a: 1 }, isError: true, fetchStatus: "idle" })).toBe("stale");
    // A retry in flight is still stale: the last refresh failed until one succeeds.
    expect(readState({ data: { a: 1 }, isError: true, fetchStatus: "fetching" })).toBe("stale");
    // An empty array is data too: a failed refresh over [] is stale, not ready.
    expect(readState({ data: [], isError: true, fetchStatus: "idle" })).toBe("stale");
  });

  it("a failed read with no data stays error while Retry is in flight (the note shows progress, not a spinner swap)", () => {
    const retrying = { data: undefined, isError: true, isLoading: false, isPending: false, fetchStatus: "fetching" };
    expect(readState(retrying)).toBe("error");
    expect(isRetrying(retrying)).toBe(true);
    expect(isRetrying({ ...retrying, fetchStatus: "idle" })).toBe(false);
    expect(isRetrying({ fetchStatus: "paused" })).toBe(false);
    expect(isRetrying({})).toBe(false);
  });

  it("a paused query with no data is offline, not loading and not empty", () => {
    expect(readState({ data: undefined, isError: false, isLoading: false, isPending: true, fetchStatus: "paused" })).toBe("offline");
  });

  it("a failed query with no data is an error", () => {
    expect(readState({ data: undefined, isError: true, isLoading: false, fetchStatus: "idle" })).toBe("error");
  });

  it("a query on its way is loading", () => {
    expect(readState({ data: undefined, isError: false, isLoading: true, fetchStatus: "fetching" })).toBe("loading");
    expect(readState({ data: undefined, isError: false, isPending: true, fetchStatus: "fetching" })).toBe("loading");
  });

  it("no data, nothing in flight and no error reads as unknown (error), never as ready", () => {
    expect(readState({ data: undefined, isError: false, isLoading: false, isPending: false, fetchStatus: "idle" })).toBe("error");
  });

  it("a mock with no fetchStatus is never offline", () => {
    expect(readState({ data: undefined, isError: false, isLoading: true })).toBe("loading");
  });
});

describe("copy", () => {
  it("names the cause and the next action, with no em dash", () => {
    expect(offlineCopy("Pattern radar")).toBe("Offline. Pattern radar shows when the connection returns.");
    expect(errorCopy("Pattern radar")).toBe("Pattern radar could not load. State unknown, not empty.");
    expect(staleCopy("Pattern radar")).toBe("Last refresh failed. Pattern radar below may be out of date.");
    for (const s of [offlineCopy("x"), errorCopy("x"), staleCopy("x")]) expect(s).not.toContain(String.fromCharCode(0x2014));
  });
});
