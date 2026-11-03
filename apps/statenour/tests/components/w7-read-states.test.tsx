// @vitest-environment jsdom
/**
 * W7 test-analyzer gaps · the weekly review and the day toggle as RENDERED from their tRPC states (react-dom/client
 * in jsdom, the brief-rows-render pattern): a failed query reads "unknown", a failed side read is named in its goal
 * block, a failed goal change is named by title after Save, a save error keeps the text, and the day toggle turns a
 * failed read into "couldn't load", never an endless "Reading that day".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Q = { data?: unknown; isLoading: boolean; isError: boolean; refetch: () => void };
const h = vi.hoisted(() => ({
  review: { data: undefined, isLoading: false, isError: false, refetch: () => {} } as Q,
  day: { data: undefined, isLoading: false, isError: false, refetch: () => {} } as Q,
  save: vi.fn(),
  saveState: { isError: false, isPending: false, error: null as { message: string } | null },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    useUtils: () => ({ journal: { feed: { invalidate: vi.fn() }, weeklyReview: { invalidate: vi.fn() } } }),
    journal: {
      weeklyReview: { useQuery: () => h.review },
      saveWeeklyReview: { useMutation: () => ({ mutateAsync: h.save, ...h.saveState }) },
      day: { useQuery: () => h.day },
    },
  },
}));

import { WeeklyReview } from "@/components/journal/weekly-review";
import { DayActivityToggle } from "@/components/journal/day-activity";

const READ = {
  since: "2026-10-26T15:00:00.000Z",
  lastReviewAt: null,
  truncated: false,
  failed: [] as string[],
  goals: [
    {
      goal: { id: "g1", title: "Ship the quote", horizon: "WEEK", due: null, canExtendOrClose: true },
      doneTasks: [],
      entries: [],
    },
  ],
};

let host: HTMLDivElement;
let root: Root;
const text = () => host.textContent ?? "";

async function mount(node: React.ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

function type(el: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const button = (label: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === label) as HTMLButtonElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  h.review = { data: READ, isLoading: false, isError: false, refetch: () => {} };
  h.day = { data: undefined, isLoading: false, isError: false, refetch: () => {} };
  h.save.mockReset();
  h.saveState = { isError: false, isPending: false, error: null };
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("WeeklyReview read states", () => {
  it("a failed review query is 'goals unknown, not empty' with a Retry", async () => {
    h.review = { data: undefined, isLoading: false, isError: true, refetch: () => {} };
    await mount(<WeeklyReview />);
    expect(text()).toContain("goals unknown, not empty");
    expect(button("Retry")).toBeTruthy();
  });

  it("failed side reads are named: entries in the goal block, the last review on its own line", async () => {
    h.review = { ...h.review, data: { ...READ, failed: ["entries", "last review"] } };
    await mount(<WeeklyReview />);
    expect(text()).toContain("Entries couldn't load");
    expect(text()).not.toContain("Nothing done or written");
    expect(text()).toContain("Couldn't read when the last review was");
  });

  it("after Save, a failed goal change is named by its title", async () => {
    h.save.mockResolvedValue({ saved: ["d1"], extended: [], achieved: [], missed: [], checkedIn: [], alreadyCheckedIn: [], skipped: [], failed: ["g1"], ungrounded: [], replayed: false });
    await mount(<WeeklyReview />);
    await act(async () => type(host.querySelectorAll("textarea")[1] as HTMLTextAreaElement, "Good week"));
    await act(async () => button("Save the review").click());
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ week: "Good week", reviewId: expect.any(String) }));
    expect(text()).toContain("Not changed: Ship the quote");
  });

  it("a save error keeps the form and says a retry is safe", async () => {
    h.saveState = { isError: true, isPending: false, error: { message: "Network lost." } };
    await mount(<WeeklyReview />);
    expect(text()).toContain("Network lost.");
    expect(text()).toContain("saving again is safe");
    expect(host.querySelectorAll("textarea").length).toBeGreaterThan(0);
  });
});

describe("DayActivityToggle read states", () => {
  it("a failed day read shows couldn't load, not an endless loading line", async () => {
    h.day = { data: undefined, isLoading: false, isError: true, refetch: () => {} };
    await mount(<DayActivityToggle date="2026-11-02" />);
    await act(async () => button("Done and contacts").click());
    expect(text()).toContain("That day couldn't load");
    expect(text()).not.toContain("Reading that day");
  });
});
