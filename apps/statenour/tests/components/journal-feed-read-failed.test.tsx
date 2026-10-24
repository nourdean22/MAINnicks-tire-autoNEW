/**
 * The journal feed tells a failed load from an empty journal (audit 09-X4).
 *
 * A failed first load rendered "No thoughts captured yet in this filter." under an 11px mono banner, so
 * a 500 read as an empty journal. Now: no entries + error is an unknown state with the reason and a 44px
 * Retry; entries + error keeps the entries under one "Refresh failed" line.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const feed = vi.hoisted(() => ({
  entries: [] as unknown[],
  error: null as string | null,
  isLoading: false,
  isOffline: false,
  refetch: () => {},
}));

vi.mock("@/app/(mastery)/journal/_hooks/use-journal-feed", () => ({
  useJournalFeed: () => ({
    entries: feed.entries,
    counts: null,
    degraded: [],
    isLoading: feed.isLoading,
    isOffline: feed.isOffline,
    isFetching: false,
    isFetchingMore: false,
    error: feed.error,
    refetch: feed.refetch,
    source: "all",
    setSourceFilter: () => {},
    type: "all",
    setTypeFilter: () => {},
    search: "",
    setSearch: () => {},
    isSearching: false,
    loadMore: () => {},
    hasMore: false,
    totalCount: 0,
  }),
}));
vi.mock("@/components/journal/entry-row", () => ({
  JournalEntryRow: ({ entry }: { entry: { title: string } }) => <div data-row>{entry.title}</div>,
}));

import { JournalFeedView } from "@/app/(mastery)/journal/_components/journal-feed-view";

const entry = { id: "e1", title: "Morning pages", body: "b", date: "2026-10-10", createdAt: "2026-10-10T12:00:00Z" };
const render = () => renderToStaticMarkup(<JournalFeedView />);

afterEach(() => {
  feed.entries = [];
  feed.error = null;
  feed.isLoading = false;
  feed.isOffline = false;
});

describe("JournalFeedView offline (truth sweep 2026-10-23)", () => {
  it("a paused first load says offline, never the empty-journal copy", () => {
    feed.isOffline = true;
    const html = render();
    expect(html).toContain("Offline. The journal shows when the connection returns.");
    expect(html).not.toContain("No thoughts captured yet");
  });

  it("control: offline with entries in hand keeps them", () => {
    feed.isOffline = true;
    feed.entries = [entry];
    const html = render();
    expect(html).toContain("Morning pages");
    expect(html).not.toContain("Offline.");
  });
});

describe("JournalFeedView read states (09-X4)", () => {
  it("a failed first load is unknown, never the empty-journal copy", () => {
    feed.error = "boom";
    const html = render();
    expect(html).toContain("State unknown");
    expect(html).toContain("boom");
    expect(html).not.toContain("No thoughts captured yet");
  });

  it("the failed state offers a 44px Retry and drops the 11px mono banner", () => {
    feed.error = "boom";
    const html = render();
    const retry = html.match(/<button[^>]*>Retry<\/button>/)?.[0] ?? "";
    expect(retry, "no Retry button").not.toBe("");
    expect(retry).toMatch(/\bmin-h-11\b/);
    expect(html).not.toMatch(/font-mono text-\[11px\]">boom/);
  });

  it("a failed refresh with entries in hand keeps them under one line", () => {
    feed.error = "boom";
    feed.entries = [entry];
    const html = render();
    expect(html).toContain("Morning pages");
    expect(html).toContain("Refresh failed. Showing the last loaded entries.");
    expect(html).not.toContain("State unknown");
  });

  it("CONTROL: a successful empty read keeps the empty copy", () => {
    const html = render();
    expect(html).toContain("No thoughts captured yet in this filter.");
    expect(html).not.toContain("State unknown");
    expect(html).not.toContain("Refresh failed");
  });
});
