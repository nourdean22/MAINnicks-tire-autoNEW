/**
 * W8b · the dossier's story panel: three states (loading / couldn't load / measured) and never an invented entry.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PersonStoryView } from "@/components/people/person-story";

const story = {
  entries: [
    { id: "d1", kind: "journal" as const, at: "2026-11-02T14:00:00.000Z", excerpt: "Talked to Dania about the move.", href: "/journal#bd-d1" },
  ],
  entriesTruncated: false,
  goals: [{ id: "g1", title: "Grow the shop", via: "tasks" as const, href: "/stats?tab=goals#goal-g1" }],
};

describe("PersonStoryView", () => {
  it("entries link to the entry, goals link to the goal", () => {
    const html = renderToStaticMarkup(<PersonStoryView story={story} />);
    expect(html).toContain('href="/journal#bd-d1"');
    expect(html).toContain("Talked to Dania about the move.");
    expect(html).toContain('href="/stats?tab=goals#goal-g1"');
    expect(html).toContain("Grow the shop");
    expect(html).not.toContain("more in the journal");
  });

  it("a cut list offers more; an empty story says nothing was written and no goal", () => {
    expect(renderToStaticMarkup(<PersonStoryView story={{ ...story, entriesTruncated: true }} />)).toContain("more in the journal");
    const empty = renderToStaticMarkup(<PersonStoryView story={{ entries: [], entriesTruncated: false, goals: [] }} />);
    expect(empty).toContain("No journal entry names them yet");
    expect(empty).toContain("No goal");
  });

  it("loading and failed are their own words; failed is not empty", () => {
    expect(renderToStaticMarkup(<PersonStoryView story="loading" />)).toContain("Loading");
    const failed = renderToStaticMarkup(<PersonStoryView story="error" />);
    expect(failed).toContain("couldn&#x27;t load");
    expect(failed).not.toContain("No journal entry");
  });
});
