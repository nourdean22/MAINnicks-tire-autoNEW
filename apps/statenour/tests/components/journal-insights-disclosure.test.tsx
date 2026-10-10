/**
 * 09-F25 (2026-10-10): on a phone the Journal stacked up to nine insight panels between the
 * composer and the entries, so the feed started screens below the fold. Below lg the panels now
 * sit in one native <details> disclosure, "Insights (n)", right after the composer; at lg the
 * disclosure is held open with its summary hidden, so the wide layout is unchanged.
 *
 * n counts panels that actually rendered: every panel returns null while loading or empty, so a
 * fixed "9" would be an invented number.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const wide = vi.hoisted(() => ({ value: false }));

vi.mock("@/hooks/use-min-width", () => ({ useMinWidth: () => wide.value }));
vi.mock("@/components/journal/nicks-journal-brief", () => ({ NicksJournalBrief: () => <section>panel-brief</section> }));
vi.mock("@/components/journal/todays-prompt", () => ({ TodaysPrompt: () => null }));
vi.mock("@/components/journal/journal-threads-strip", () => ({ JournalThreadsStrip: () => null }));
vi.mock("@/components/journal/journal-insights-preview", () => ({ JournalInsightsPreview: () => <section>panel-preview</section> }));
vi.mock("@/components/journal/metacognition-card", () => ({ MetacognitionCard: () => null }));
vi.mock("@/components/journal/thread-radar", () => ({ ThreadRadar: () => <section>panel-radar</section> }));
vi.mock("@/components/journal/thread-rail", () => ({ ThreadRail: () => null }));
vi.mock("@/components/journal/thread-suggestions", () => ({ ThreadSuggestions: () => null }));
vi.mock("@/app/(mastery)/journal/_components/notebooklm-context-zone", () => ({ NotebookLMContextZone: () => <section>panel-notebook</section> }));

import { JournalInsightsView, countRenderedPanels } from "@/app/(mastery)/journal/_components/journal-insights-view";

const render = () => renderToStaticMarkup(<JournalInsightsView threadRefresh={0} setThreadRefresh={() => {}} />);

afterEach(() => {
  wide.value = false;
});

describe("JournalInsightsView on a phone", () => {
  it("renders ONE collapsed disclosure labelled Insights, with the panels inside it", () => {
    const html = render();
    expect(html.match(/<details/g)?.length).toBe(1);
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).toMatch(/<summary[^>]*>[\s\S]*Insights[\s\S]*<\/summary>/);
    const inside = html.slice(html.indexOf("</summary>"));
    for (const panel of ["panel-brief", "panel-preview", "panel-radar", "panel-notebook"]) expect(inside).toContain(panel);
  });

  it("the summary is phone-only chrome", () => {
    expect(render()).toMatch(/<summary[^>]*class="[^"]*\blg:hidden\b/);
  });
});

describe("JournalInsightsView at lg", () => {
  it("is held open, so the right column reads exactly as before", () => {
    wide.value = true;
    expect(render()).toMatch(/<details[^>]*\sopen=""/);
  });
});

describe("countRenderedPanels", () => {
  const el = (children: unknown[] = [], group = false) => ({
    children,
    hasAttribute: (name: string) => group && name === "data-panel-group",
  });

  it("counts direct panels, and the panels inside a grouped wrapper rather than the wrapper", () => {
    const body = el([el(), el(), el([el(), el()], true), el()]);
    expect(countRenderedPanels(body)).toBe(5);
  });

  it("an empty group contributes nothing (all three thread panels returned null)", () => {
    expect(countRenderedPanels(el([el(), el([], true)]))).toBe(1);
  });
});
