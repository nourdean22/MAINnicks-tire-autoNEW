/**
 * local-checklist.test.tsx · 2026-10-25 (job 2026-10-25-admin-tabs-localchecklist)
 *
 * Website & Local > Entity / Brand and GBP Q&A: each item can be marked done with one tap
 * (localGrowth.setChecklistItem), the mark shows its date and who made it, and Clear removes it.
 * A failed read of the marks renders no count and no buttons: unknown, never "0 of N".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

type Q = { data: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void; isFetching: boolean };
type MutOpts = { onSuccess?: (res: unknown, input: unknown) => void; onError?: (err: Error) => void };

const h = vi.hoisted(() => ({
  queries: new Map<string, Partial<Q>>(),
  calls: [] as unknown[],
  // What the mocked server answers to a mutate; undefined = no answer yet.
  answer: undefined as unknown,
  toastError: vi.fn(),
}));

vi.mock("@/lib/trpc", () => {
  const query = (path: string) => () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
    isFetching: false,
    ...h.queries.get(path),
  });
  const mutation = () => (opts?: MutOpts) => ({
    mutate: (input: unknown) => {
      h.calls.push(input);
      if (h.answer !== undefined) opts?.onSuccess?.(h.answer, input);
    },
    mutateAsync: async () => ({}),
    isPending: false,
    isSuccess: false,
    reset: () => {},
  });
  const node = (path: string): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery" || key === "useSuspenseQuery" || key === "useInfiniteQuery") return query(path);
        if (key === "useMutation") return mutation();
        return node(path ? `${path}.${String(key)}` : String(key));
      },
      apply() {
        return undefined;
      },
    });
  const root = new Proxy({}, {
    get(_t, key) {
      if (key === "useUtils" || key === "useContext") return () => node("utils");
      return node(String(key));
    },
  });
  return { trpc: root };
});

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: h.toastError, info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
  Toaster: () => null,
}));

import { EntityTab, GbpQaTab, LocalGrowthTab } from "@/pages/admin/GrowthSection";
import { ENTITY_PLATFORMS } from "@/lib/entityConsistency";
import { GBP_QA_SEEDS } from "@/lib/gbpQaSeeds";

const CHECKLIST = "localGrowth.checklist";
const OK = {
  ok: true,
  items: {
    "entity-yelp": { checkedAt: "2026-10-25T15:00:00.000Z", note: null, by: "nour@example.com" },
    "qa-used-tire-price": { checkedAt: "2026-10-24T12:00:00.000Z", note: null, by: "Nour" },
  },
  skipped: 0,
};
const FAILED = { ok: false, reason: "error", message: "boom" };

const entityRow = (platform: string) => screen.getByText(platform).closest("[data-checklist-row]") as HTMLElement;
const qaRow = (question: string) => screen.getByText(question).closest("[data-checklist-row]") as HTMLElement;

beforeEach(() => {
  h.queries.clear();
  h.calls.length = 0;
  h.answer = undefined;
  h.toastError.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("checklist ids", () => {
  it("every Entity platform and Q&A pair has a unique id the server slug rule accepts", () => {
    const slugs = [
      ...ENTITY_PLATFORMS.map((p) => `entity-${p.id}`),
      ...GBP_QA_SEEDS.map((q) => `qa-${q.id}`),
    ];
    expect(slugs.every((s) => /^[a-z0-9-]{1,60}$/.test(s))).toBe(true);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(ENTITY_PLATFORMS.map((p) => p.id)).toEqual([
      "google-business-profile", "facebook", "instagram", "yelp", "carfax", "bbb", "acima",
      "mapquest", "old-google-sites", "other-directories",
    ]);
    expect(GBP_QA_SEEDS.find((q) => q.id === "used-tire-price")?.question).toBe("Do you sell used tires, and how much are they?");
  });
});

describe("EntityTab: verification marks", () => {
  it("shows the dated mark with the name only, a count with its denominator, and a button per row", () => {
    h.queries.set(CHECKLIST, { data: OK });
    const { container } = render(<EntityTab />);
    const yelp = entityRow("Yelp");
    expect(within(yelp).getByText("Verified Oct 25 by nour")).toBeTruthy();
    expect(within(yelp).getByRole("button", { name: "Clear" })).toBeTruthy();
    expect(within(yelp).queryByRole("button", { name: "Mark verified" })).toBeNull();
    expect(container.textContent).not.toContain("@example.com");
    expect(screen.getByText(`1 of ${ENTITY_PLATFORMS.length} verified`)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Mark verified" })).toHaveLength(ENTITY_PLATFORMS.length - 1);
    expect(within(entityRow("Facebook")).getByText("not verified")).toBeTruthy();
    // Every mark and clear control is a 44 px tap target.
    for (const b of [...screen.getAllByRole("button", { name: "Mark verified" }), screen.getByRole("button", { name: "Clear" })]) {
      expect(b.className).toContain("min-h-12");
    }
  });

  it("dates the mark on the shop's calendar, not the device's (11:30 PM Cleveland is still that day)", () => {
    // 03:30Z on Oct 25 is 11:30 PM on Oct 24 in America/New_York; a UTC host (CI) would print Oct 25.
    h.queries.set(CHECKLIST, {
      data: { ...OK, items: { ...OK.items, "entity-facebook": { checkedAt: "2026-10-25T03:30:00.000Z", note: null, by: "Nour" } } },
    });
    render(<EntityTab />);
    expect(within(entityRow("Facebook")).getByText("Verified Oct 24 by Nour")).toBeTruthy();
  });

  it("Mark verified sends checked true for that slug; Clear sends checked false; no native dialog", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const alertSpy = vi.spyOn(window, "alert");
    const promptSpy = vi.spyOn(window, "prompt");
    h.queries.set(CHECKLIST, { data: OK });
    render(<EntityTab />);
    fireEvent.click(within(entityRow("Google Business Profile")).getByRole("button", { name: "Mark verified" }));
    fireEvent.click(within(entityRow("Yelp")).getByRole("button", { name: "Clear" }));
    expect(h.calls).toEqual([
      { slug: "entity-google-business-profile", checked: true },
      { slug: "entity-yelp", checked: false },
    ]);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it("a save the server refused shows its message in a toast", () => {
    h.queries.set(CHECKLIST, { data: OK });
    h.answer = { ok: false, reason: "error", message: "The mark was not saved: timeout" };
    render(<EntityTab />);
    fireEvent.click(within(entityRow("Facebook")).getByRole("button", { name: "Mark verified" }));
    expect(h.toastError).toHaveBeenCalledWith("The mark was not saved: timeout");
  });

  it("a failed read shows one error with retry, no count, no not-verified claim and no mark buttons", () => {
    const refetch = vi.fn();
    h.queries.set(CHECKLIST, { data: FAILED, refetch });
    const { container } = render(<EntityTab />);
    const msg = screen.getByText("Verification marks couldn't load: unknown, not unchecked.");
    const retry = within(msg.parentElement as HTMLElement).getByRole("button", { name: /try again/i });
    expect(retry.className).toContain("min-h-12");
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalled();
    expect(container.textContent).not.toMatch(/\d+ of \d+ verified/);
    expect(screen.queryByText("not verified")).toBeNull();
    expect(screen.queryByRole("button", { name: /Mark verified|Clear/ })).toBeNull();
    // The rows themselves still render.
    expect(screen.getByText("Yelp")).toBeTruthy();
  });

  it("a thrown read (isError) is the same unknown state", () => {
    h.queries.set(CHECKLIST, { isError: true });
    render(<EntityTab />);
    expect(screen.getByText("Verification marks couldn't load: unknown, not unchecked.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Mark verified/ })).toBeNull();
  });

  it("while loading there is no count and no buttons", () => {
    h.queries.set(CHECKLIST, { isLoading: true });
    const { container } = render(<EntityTab />);
    expect(container.textContent).not.toMatch(/\d+ of \d+ verified/);
    expect(screen.queryByRole("button", { name: /Mark verified|Clear/ })).toBeNull();
    expect(screen.queryByText(/couldn't load/)).toBeNull();
  });

  it("says when stored marks could not be read", () => {
    h.queries.set(CHECKLIST, { data: { ...OK, skipped: 2 } });
    render(<EntityTab />);
    expect(screen.getByText("2 saved marks could not be read and show as not done.")).toBeTruthy();
  });
});

describe("GbpQaTab: posted marks", () => {
  it("shows Posted with its date on the marked pair and a count of all pairs", () => {
    h.queries.set(CHECKLIST, { data: OK });
    render(<GbpQaTab />);
    const used = qaRow("Do you sell used tires, and how much are they?");
    expect(within(used).getByText("Posted Oct 24 by Nour")).toBeTruthy();
    expect(within(used).getByRole("button", { name: "Clear" })).toBeTruthy();
    expect(screen.getByText(`1 of ${GBP_QA_SEEDS.length} posted`)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Mark posted" })).toHaveLength(GBP_QA_SEEDS.length - 1);
  });

  it("Mark posted sends the qa slug", () => {
    h.queries.set(CHECKLIST, { data: OK });
    render(<GbpQaTab />);
    fireEvent.click(within(qaRow("What should I bring for my visit?")).getByRole("button", { name: "Mark posted" }));
    expect(h.calls).toEqual([{ slug: "qa-what-to-bring", checked: true }]);
  });

  it("a failed read shows the error and no count or buttons", () => {
    h.queries.set(CHECKLIST, { data: FAILED });
    const { container } = render(<GbpQaTab />);
    expect(screen.getByText("Posted marks couldn't load: unknown, not unposted.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d+ of \d+ posted/);
    expect(screen.queryByRole("button", { name: /Mark posted|Clear/ })).toBeNull();
  });
});

describe("LocalGrowthTab: next owner actions count the marks", () => {
  it("adds n of total done to the Q&A and Entity items", () => {
    h.queries.set(CHECKLIST, { data: OK });
    render(<LocalGrowthTab />);
    expect(screen.getByText(`Post the GBP Q&A seeds (next tab over): ~15 min, highest local-SEO ROI. (1 of ${GBP_QA_SEEDS.length} done)`)).toBeTruthy();
    expect(screen.getByText(`Work the Entity / Brand checklist top-to-bottom (GBP first). (1 of ${ENTITY_PLATFORMS.length} done)`)).toBeTruthy();
  });

  it("says unknown when the read failed, never 0 done", () => {
    h.queries.set(CHECKLIST, { data: FAILED });
    const { container } = render(<LocalGrowthTab />);
    expect(screen.getByText("Post the GBP Q&A seeds (next tab over): ~15 min, highest local-SEO ROI. (unknown)")).toBeTruthy();
    expect(screen.getByText("Work the Entity / Brand checklist top-to-bottom (GBP first). (unknown)")).toBeTruthy();
    expect(container.textContent).not.toMatch(/of \d+ done/);
  });
});
