/**
 * Page views had no opt-out (audit 02-F1). PageTracker now skips the visit write when localStorage
 * 'nour:no-track' is '1'. useEffect does not run under node SSR, so it runs inline here and the component is
 * called as a plain function with its hooks mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mutate = vi.hoisted(() => vi.fn());
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useEffect: (fn: () => void) => void fn() };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/journal" }));
vi.mock("@/lib/trpc/client", () => ({ trpc: { brain: { pageVisit: { useMutation: () => ({ mutate }) } } } }));

import { PageTracker } from "@/components/brain/page-tracker";

function stubStorage(value: string | null, throws = false) {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => {
        if (throws) throw new Error("SecurityError");
        return k === "nour:no-track" ? value : null;
      },
    },
  });
}

beforeEach(() => {
  mutate.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("PageTracker opt-out", () => {
  it("does not record the visit when nour:no-track is '1'", () => {
    stubStorage("1");
    PageTracker();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("control: records the visit once when the key is unset", () => {
    stubStorage(null);
    PageTracker();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ page: "/journal" }));
  });

  it("still records when storage throws (private mode), since no opt-out could be read", () => {
    stubStorage(null, true);
    PageTracker();
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
