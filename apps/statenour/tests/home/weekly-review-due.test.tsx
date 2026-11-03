/**
 * W8b (item 7) · Home says when the weekly review is due, shows today's done tasks and contacts, and the journal
 * day view opens for any day. Every read renders three states; a failed read is unknown, never "nothing due".
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ dumpFindFirst: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { brainDump: { findFirst: h.dumpFindFirst } } }));
const logWarn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logger", async (orig) => {
  const m = await orig<typeof import("@/lib/logger")>();
  return { ...m, logger: { ...m.logger, withSurface: (s: string) => ({ ...m.logger.withSurface(s), warn: logWarn }) } };
});
vi.mock("@/lib/services/outcome-ledger", () => ({ recordShownBounded: vi.fn(async () => "led") }));

import { __testInternals } from "@/lib/home/operator-brief";
import { REVIEW_ENTRY_TYPE, REVIEW_WINDOW_DAYS } from "@/lib/brain/journal-review-marker";
import { ReviewCardView, TodayCardView } from "@/components/home/home-cards";
import { DayPickerView } from "@/components/journal/day-picker";

const DAY = 86_400_000;
const NOW = new Date("2026-11-03T15:00:00Z");

beforeEach(() => {
  h.dumpFindFirst.mockReset();
  logWarn.mockClear();
});

describe("loadWeeklyReviewDue (the brief's read)", () => {
  it("reads the newest weekly_review entry; 7 or more days since makes it due", async () => {
    expect(REVIEW_WINDOW_DAYS).toBe(7);
    h.dumpFindFirst.mockResolvedValue({ createdAt: new Date(NOW.getTime() - 9 * DAY) });
    const r = await __testInternals.loadWeeklyReviewDue(NOW);
    expect(r).toEqual({ lastReviewAt: new Date(NOW.getTime() - 9 * DAY).toISOString(), daysSince: 9, due: true });
    const q = h.dumpFindFirst.mock.calls[0][0];
    expect(q.where).toEqual({ entryType: REVIEW_ENTRY_TYPE, deletedAt: null });
    expect(q.orderBy).toEqual({ createdAt: "desc" });
  });

  it("a review 3 days ago is not due; none ever is due with daysSince null", async () => {
    h.dumpFindFirst.mockResolvedValue({ createdAt: new Date(NOW.getTime() - 3 * DAY) });
    expect(await __testInternals.loadWeeklyReviewDue(NOW)).toMatchObject({ daysSince: 3, due: false });
    h.dumpFindFirst.mockResolvedValue(null);
    expect(await __testInternals.loadWeeklyReviewDue(NOW)).toEqual({ lastReviewAt: null, daysSince: null, due: true });
  });

  it("a failed read is unknown, logged, and named in the failed sources", async () => {
    h.dumpFindFirst.mockRejectedValue(new Error("review-read-marker"));
    const r = await __testInternals.loadWeeklyReviewDue(NOW);
    expect(r).toBe("unknown");
    expect(JSON.stringify(logWarn.mock.calls)).toContain("review-read-marker");
    const OK = { contradictions: [], proposals: [], followUps: [], pendingActions: [], approvalRequests: [], goalCheckInDue: null };
    expect(__testInternals.collectFailedSources({ ...OK, weeklyReviewDue: r })).toEqual(["weekly review"]);
    expect(__testInternals.collectFailedSources({ ...OK, weeklyReviewDue: { lastReviewAt: null, daysSince: null, due: true } })).toEqual([]);
  });
});

describe("ReviewCardView (Home)", () => {
  it("due: names the days since; never done says so; both open the review", () => {
    const due = renderToStaticMarkup(<ReviewCardView read={{ lastReviewAt: "x", daysSince: 9, due: true }} />);
    expect(due).toContain("Weekly review due");
    expect(due).toContain("9d since the last");
    expect(due).toContain('href="/journal?review=week"');
    expect(renderToStaticMarkup(<ReviewCardView read={{ lastReviewAt: null, daysSince: null, due: true }} />)).toContain("never done");
  });
  it("not due says when; unknown is unknown, never 'due' or 'done'", () => {
    const done = renderToStaticMarkup(<ReviewCardView read={{ lastReviewAt: "x", daysSince: 3, due: false }} />);
    expect(done).toContain("3d ago");
    expect(done).not.toContain("due");
    const unknown = renderToStaticMarkup(<ReviewCardView read="unknown" />).toLowerCase();
    expect(unknown).toContain("unknown");
    expect(unknown).not.toContain("due ");
    expect(renderToStaticMarkup(<ReviewCardView read="loading" />)).toContain("aria-busy");
  });
});

describe("TodayCardView (Home)", () => {
  const day = { date: "2026-11-03", tasksDone: [{ taskId: "t1", title: "Hung the shelving", at: NOW.toISOString(), goal: null }], contacts: [], failed: [], truncated: [] };
  it("heads the day panel with the date and shows its rows; failed is said", () => {
    const html = renderToStaticMarkup(<TodayCardView date="2026-11-03" read={day} />);
    expect(html).toContain("Today: done and contacts");
    expect(html).toContain("Hung the shelving");
    const failed = renderToStaticMarkup(<TodayCardView date="2026-11-03" read="failed" />).toLowerCase();
    expect(failed).toMatch(/couldn|unknown/);
  });
});

describe("DayPickerView (/journal)", () => {
  it("a date input at 16px, a Yesterday shortcut, and the chosen day's panel", () => {
    const html = renderToStaticMarkup(<DayPickerView date="2026-11-02" onChange={() => {}} read="loading" />);
    expect(html).toContain('type="date"');
    expect(html).toContain('value="2026-11-02"');
    expect(html).toMatch(/text-\[16px\]/);
    expect(html).toContain("Yesterday");
    expect(html).toContain("min-h-\\[44px\\]".replace(/\\/g, "") );
  });
});
