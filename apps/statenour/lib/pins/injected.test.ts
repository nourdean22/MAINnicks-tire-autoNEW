import { describe, it, expect } from "vitest";
import { selectInjectedPinIds } from "./injected";

describe("selectInjectedPinIds", () => {
  it("injects the first 5 in server order", () => {
    const server = ["a", "b", "c", "d", "e", "f", "g"];
    const set = selectInjectedPinIds(server, 5);
    expect([...set].sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(set.has("f")).toBe(false);
  });

  it("is independent of how the caller sorts the list (regression for the idx<5 bug)", () => {
    // Server/injection order is a..f. The badge set must be a..e even
    // though a display layer might render them stalest-first (f..a).
    const server = ["a", "b", "c", "d", "e", "f"];
    const injected = selectInjectedPinIds(server, 5);
    expect(injected.has("a")).toBe(true); // injected, regardless of display position
    expect(injected.has("f")).toBe(false); // not injected even if shown first when sorted
  });

  it("respects an authoritative injectedCount below 5", () => {
    const set = selectInjectedPinIds(["a", "b", "c", "d", "e"], 3);
    expect([...set].sort()).toEqual(["a", "b", "c"]);
  });

  it("falls back to top-5 when count is missing", () => {
    const set = selectInjectedPinIds(["a", "b", "c", "d", "e", "f"]);
    expect(set.size).toBe(5);
    expect(set.has("f")).toBe(false);
  });

  it("never exceeds the number of pins", () => {
    expect(selectInjectedPinIds(["a", "b"], 5).size).toBe(2);
    expect(selectInjectedPinIds([], 5).size).toBe(0);
  });

  it("caps at 5 even if the server over-reports the count", () => {
    expect(selectInjectedPinIds(["a", "b", "c", "d", "e", "f", "g"], 7).size).toBe(5);
  });
});
