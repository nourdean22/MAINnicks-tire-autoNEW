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
import { errorCopy, offlineCopy, readState } from "@/lib/query-state";

describe("readState", () => {
  it("data in hand is ready, even when a later refetch failed or paused (stale beats blank)", () => {
    expect(readState({ data: [], isError: false, fetchStatus: "idle" })).toBe("ready");
    expect(readState({ data: { a: 1 }, isError: true, fetchStatus: "idle" })).toBe("ready");
    expect(readState({ data: { a: 1 }, isError: false, fetchStatus: "paused" })).toBe("ready");
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
    for (const s of [offlineCopy("x"), errorCopy("x")]) expect(s).not.toContain(String.fromCharCode(0x2014));
  });
});
