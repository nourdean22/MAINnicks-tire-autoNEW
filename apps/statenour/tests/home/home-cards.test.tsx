/**
 * Home W2b cards (2026-10-30, home-pulse). Nour: "include some cards, some shortcuts". Home already shows
 * Today and Needs-you as the brief, so the cards carry only what Home lacked: people who are due a
 * touch (the existing /people model) and the next goal deadline (operator.goalsSnapshot). Each card
 * consumes an existing read model and owns none of it. Three states each; a failed read is unknown,
 * never "0 people" or "no goals".
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PeopleCardView, GoalsCardView, nextGoalDue } from "@/components/home/home-cards";

const NOW = Date.parse("2026-10-30T17:40:00Z");
const goal = (title: string, deadline: string | null, status = "active") => ({ title, deadline, status });

describe("nextGoalDue", () => {
  it("picks the nearest open deadline and counts goals with one", () => {
    const r = nextGoalDue(
      [goal("Later", "2026-12-01T05:00:00Z"), goal("Soon", "2026-11-02T05:00:00Z"), goal("No date", null)],
      NOW,
    );
    expect(r).toMatchObject({ title: "Soon", withDeadline: 2 });
    expect(r?.label).toMatch(/d left$/);
  });

  it("achieved goals are not 'next'", () => {
    expect(nextGoalDue([goal("Done one", "2026-11-01T05:00:00Z", "achieved")], NOW)).toBeNull();
  });
});

describe("People card", () => {
  it("names how many people are due a touch", () => {
    const text = renderToStaticMarkup(<PeopleCardView read={{ neglected: 3, total: 20 }} />).replace(/<[^>]+>/g, "");
    expect(text).toContain("3 due a touch");
  });
  it("a failed read is unknown, never 0", () => {
    const html = renderToStaticMarkup(<PeopleCardView read="error" />);
    expect(html.toLowerCase()).toContain("unknown");
    expect(html).not.toContain("0 due");
  });
  it("control: a measured zero says everyone is current", () => {
    expect(renderToStaticMarkup(<PeopleCardView read={{ neglected: 0, total: 20 }} />)).toContain("All current");
  });
});

describe("Goals card", () => {
  it("shows the next deadline", () => {
    const html = renderToStaticMarkup(
      <GoalsCardView read={{ title: "Demo goal", label: "3d left", withDeadline: 2 }} />,
    );
    expect(html).toContain("Demo goal");
    expect(html).toContain("3d left");
  });
  it("a failed read is unknown, never 'no goals'", () => {
    const html = renderToStaticMarkup(<GoalsCardView read="error" />);
    expect(html.toLowerCase()).toContain("unknown");
    expect(html.toLowerCase()).not.toContain("no dated goals");
  });
  it("control: a measured empty says no dated goals", () => {
    expect(renderToStaticMarkup(<GoalsCardView read={null} />).toLowerCase()).toContain("no dated goals");
  });
  it("both cards open their full page", () => {
    expect(renderToStaticMarkup(<PeopleCardView read="loading" />)).toContain('href="/people"');
    expect(renderToStaticMarkup(<GoalsCardView read="loading" />)).toContain('href="/stats"');
  });
});
