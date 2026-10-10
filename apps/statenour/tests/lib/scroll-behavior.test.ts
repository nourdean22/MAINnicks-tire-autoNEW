/**
 * 09-F13 (2026-10-10): the reduced-motion kill switch in effects.css only reaches CSS. A JS
 * `scrollIntoView({ behavior: "smooth" })` ignores it, so every non-chat JS scroll asks
 * scrollBehavior() instead.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollBehavior } from "@/lib/ui/scroll-behavior";

function stubMatchMedia(reduce: boolean) {
  const queries: string[] = [];
  vi.stubGlobal("window", {
    matchMedia: (q: string) => {
      queries.push(q);
      return { matches: reduce };
    },
  });
  return queries;
}

afterEach(() => vi.unstubAllGlobals());

describe("scrollBehavior()", () => {
  it("is instant under prefers-reduced-motion: reduce", () => {
    const queries = stubMatchMedia(true);
    expect(scrollBehavior()).toBe("auto");
    expect(queries).toEqual(["(prefers-reduced-motion: reduce)"]);
  });

  it("is smooth when the operator has not asked for less motion", () => {
    stubMatchMedia(false);
    expect(scrollBehavior()).toBe("smooth");
  });

  it("is instant when there is no window to ask (server render)", () => {
    expect(typeof window).toBe("undefined");
    expect(scrollBehavior()).toBe("auto");
  });
});
