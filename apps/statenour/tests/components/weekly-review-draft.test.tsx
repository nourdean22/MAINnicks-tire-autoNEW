/**
 * W8b (item 6, audit B11) · the weekly review keeps a draft in localStorage (the reflect composer's DRAFT_KEY shape):
 * an iOS PWA reload mid-review restores the notes, the actions AND the form's reviewId, so a save after the reload
 * is the same review to the server (no double write). Saving clears the draft. localStorage is wrapped in try/catch:
 * a blocked store never breaks the form. The saved screen is honest about a replay (goal actions unknown).
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({ mutateAsync: vi.fn(), invalidate: vi.fn() }));
vi.mock("next/link", () => ({ default: (p: { href: string; children: React.ReactNode }) => <a href={p.href}>{p.children}</a> }));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    useUtils: () => ({ journal: { feed: { invalidate: h.invalidate }, weeklyReview: { invalidate: h.invalidate } } }),
    journal: {
      weeklyReview: {
        useQuery: () => ({
          isLoading: false,
          isError: false,
          data: {
            since: "2026-10-27T15:00:00.000Z",
            lastReviewAt: null,
            goals: [{ goal: { id: "g1", title: "Goal one", horizon: "WEEK", due: null, canExtendOrClose: true }, doneTasks: [], entries: [] }],
            failed: [],
            truncated: false,
          },
          refetch: vi.fn(),
        }),
      },
      saveWeeklyReview: { useMutation: () => ({ mutateAsync: h.mutateAsync, isPending: false, isError: false, error: null }) },
    },
  },
}));

import { REVIEW_DRAFT_KEY, ReviewSavedView, WeeklyReview } from "@/components/journal/weekly-review";

let root: Root | null = null;
let host: HTMLDivElement;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<WeeklyReview />));
  await flush();
}
const stored = () => JSON.parse(localStorage.getItem(REVIEW_DRAFT_KEY) ?? "null") as null | { reviewId: string; week: string; notes: Record<string, string>; actions: Record<string, string | null> };
function type(el: HTMLTextAreaElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  h.mutateAsync.mockReset();
  h.invalidate.mockReset();
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

describe("weekly review draft", () => {
  it("typing persists the week note, the goal note, the action and the reviewId; a reload restores all four", async () => {
    await mount();
    const [goalBox, weekBox] = Array.from(host.querySelectorAll("textarea")) as HTMLTextAreaElement[];
    type(goalBox, "moved the shelving");
    type(weekBox, "a slow week");
    act(() => (host.querySelector('button[aria-pressed="false"]') as HTMLButtonElement).click());
    const d = stored();
    expect(d).toMatchObject({ week: "a slow week", notes: { g1: "moved the shelving" }, actions: { g1: "extend" } });
    expect(d!.reviewId).toMatch(/[0-9a-f-]{20,}/);
    const firstId = d!.reviewId;

    // The reload: a fresh mount reads the draft back, same reviewId.
    act(() => root?.unmount());
    host.remove();
    await mount();
    const boxes = Array.from(host.querySelectorAll("textarea")) as HTMLTextAreaElement[];
    expect(boxes.map((b) => b.value)).toEqual(["moved the shelving", "a slow week"]);
    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe("Extend a week");
    expect(stored()!.reviewId).toBe(firstId);
  });

  it("a saved review clears the draft; the server got the restored reviewId", async () => {
    localStorage.setItem(REVIEW_DRAFT_KEY, JSON.stringify({ reviewId: "rev-restored-0001", week: "w", notes: {}, actions: {} }));
    h.mutateAsync.mockResolvedValue({ saved: ["d1"], extended: [], closed: [], skipped: [], failed: [], ungrounded: [], replayed: false, goalActions: "applied", people: { names: [] } });
    await mount();
    await act(async () => (Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Save the review") as HTMLButtonElement).click());
    await flush();
    expect(h.mutateAsync.mock.calls[0][0]).toMatchObject({ reviewId: "rev-restored-0001", week: "w" });
    expect(localStorage.getItem(REVIEW_DRAFT_KEY)).toBeNull();
    expect(host.textContent).toContain("Saved 1 entry");
  });

  it("a blocked localStorage never breaks the form", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    await mount();
    type(host.querySelector("textarea") as HTMLTextAreaElement, "still typing");
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("still typing");
    spy.mockRestore();
  });
});

describe("ReviewSavedView · replay honesty", () => {
  const base = { saved: ["a"], extended: [], closed: [], skipped: [], failed: [], ungrounded: [], people: null };
  it("a replay says the goal changes are unknown and points at Goals; a fresh save says what it did", () => {
    const replay = renderToStaticMarkup(<ReviewSavedView result={{ ...base, replayed: true, goalActions: "unknown" }} titles={new Map()} />);
    expect(replay).toContain("already saved");
    expect(replay).toMatch(/goal changes .*unknown/i);
    expect(replay).not.toContain("not repeated");
    const fresh = renderToStaticMarkup(<ReviewSavedView result={{ ...base, replayed: false, goalActions: "applied", extended: ["g1"] }} titles={new Map()} />);
    expect(fresh).toContain("extended 1");
  });
  it("names the people the notes reached; a failed link is said", () => {
    expect(renderToStaticMarkup(<ReviewSavedView result={{ ...base, replayed: false, goalActions: "applied", people: { names: ["Dania"] } }} titles={new Map()} />)).toContain("People: Dania");
    expect(renderToStaticMarkup(<ReviewSavedView result={{ ...base, replayed: false, goalActions: "applied", people: null }} titles={new Map()} />)).toMatch(/people.*couldn/i);
  });
});
