/**
 * W8b Codex round, finding 4 · /journal?entry=<id> shows that entry at the top of the feed, whatever its age, and says
 * so when it cannot: a failed read is unknown, a missing entry is "not found", and neither is an empty journal.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/journal/entry-row", () => ({
  JournalEntryRow: ({ entry }: { entry: { id: string } }) => <div id={`bd-${entry.id}`}>entry {entry.id}</div>,
}));
vi.mock("@/lib/trpc/client", () => ({ trpc: {} }));

import { LinkedEntryView } from "@/components/journal/linked-entry";
import type { FeedEntry } from "@/components/journal/types";

const view = (read: Parameters<typeof LinkedEntryView>[0]["read"]) => renderToStaticMarkup(<LinkedEntryView read={read} />);

describe("LinkedEntryView", () => {
  it("an entry renders with the anchor the link names", () => {
    expect(view({ id: "d-old" } as FeedEntry)).toContain('id="bd-d-old"');
  });
  it("not found says so", () => {
    expect(view(null)).toContain("That entry wasn&#x27;t found");
  });
  it("a failed read is unknown, not not-found", () => {
    const html = view("failed");
    expect(html).toContain("couldn&#x27;t load");
    expect(html).not.toContain("wasn&#x27;t found");
  });
  it("loading says loading", () => {
    expect(view("loading")).toContain('aria-busy="true"');
  });
});
