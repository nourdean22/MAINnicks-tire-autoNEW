/**
 * The goal card's check-in pieces (job 2026-11-02-nour-os-interconnect W2): the health chip (Linear L2),
 * the "since last check-in" list (Tana T1) and the check-in form (Linear L4). Views take plain data so
 * each state renders without a network.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { healthChipView, SinceCheckInView, CheckInFormView } from "@/components/goals/goal-check-in";

describe("healthChipView", () => {
  it("maps the five states to sentence-case copy and the existing tones", () => {
    expect(healthChipView("on_track")).toMatchObject({ label: "on track" });
    expect(healthChipView("on_track").tone).toContain("emerald");
    expect(healthChipView("at_risk")).toMatchObject({ label: "at risk" });
    expect(healthChipView("at_risk").tone).toContain("amber");
    expect(healthChipView("off_track")).toMatchObject({ label: "off track" });
    expect(healthChipView("off_track").tone).toContain("rose");
    expect(healthChipView("no_check_in")).toMatchObject({ label: "no check-in · check in" });
    expect(healthChipView("unknown")).toMatchObject({ label: "health unknown" });
    // gray is the neutral token, never a green or a new colour
    expect(healthChipView("no_check_in").tone).not.toMatch(/emerald|amber|rose/);
  });
});

describe("SinceCheckInView", () => {
  const at = "2026-11-01T12:00:00.000Z";
  it("a failed read is 'couldn't read', never an empty list", () => {
    const html = renderToStaticMarkup(<SinceCheckInView read="error" />);
    expect(html).toMatch(/Couldn.*t read what happened since the last check-in/);
    expect(html).not.toContain("Nothing logged");
  });
  it("lists kind · title · when, and one line per failed source", () => {
    const html = renderToStaticMarkup(
      <SinceCheckInView
        read={{ since: at, total: 3, items: [{ at, kind: "task", title: "Call the bank" }], failed: ["journal", "chat"] }}
        now={Date.parse("2026-11-02T12:00:00Z")}
      />,
    );
    expect(html).toContain("task · Call the bank · 1d ago");
    expect(html).toMatch(/couldn.*t read journal/);
    expect(html).toMatch(/couldn.*t read chat/);
    expect(html).toContain("+2 more");
  });
  it("counts ET calendar days: a 10 pm item read at 8 am the next day is 1d ago (silent-failure reader 2026-11-03)", () => {
    const html = renderToStaticMarkup(
      <SinceCheckInView
        read={{ since: null, total: 1, items: [{ at: "2026-11-02T03:00:00.000Z", kind: "task", title: "Late call" }], failed: [] }}
        now={Date.parse("2026-11-02T13:00:00Z")}
      />,
    );
    expect(html).toContain("task · Late call · 1d ago");
  });
  it("a goal the read could not find says so, not 'couldn't read' (second reader P3-2)", () => {
    const html = renderToStaticMarkup(<SinceCheckInView read="not_found" />);
    expect(html).toContain("Goal not found");
    expect(html).not.toMatch(/Couldn.*t read/);
  });
  it("a measured empty read says nothing was logged", () => {
    const html = renderToStaticMarkup(<SinceCheckInView read={{ since: at, total: 0, items: [], failed: [] }} />);
    expect(html).toContain("Nothing logged since the last check-in");
  });
});

describe("CheckInFormView", () => {
  it("every control clears the 44px floor and the text fields are 16px (no iOS zoom)", () => {
    const html = renderToStaticMarkup(
      <CheckInFormView
        metric
        unit="$"
        health="at_risk"
        note="Two tasks closed"
        value="5200"
        draftState={{ kind: "drafted" }}
        saving={false}
        error={null}
        onHealth={() => {}}
        onNote={() => {}}
        onValue={() => {}}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    const controls = html.match(/<(button|input|textarea)[^>]*>/g) ?? [];
    expect(controls.length).toBeGreaterThanOrEqual(6);
    for (const c of controls) expect(c, c).toContain("min-h-11");
    for (const c of html.match(/<(input|textarea)[^>]*>/g) ?? []) expect(c, c).toContain("text-[16px]");
    expect(html).toContain("Drafted by Nick, edit before saving");
  });
  it("an unavailable draft falls back to the manual field and says why", () => {
    const html = renderToStaticMarkup(
      <CheckInFormView
        metric={false}
        unit=""
        health={null}
        note=""
        value=""
        draftState={{ kind: "unavailable", reason: "nothing logged since the last check-in" }}
        saving={false}
        error={null}
        onHealth={() => {}}
        onNote={() => {}}
        onValue={() => {}}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain("No draft: nothing logged since the last check-in");
    expect(html).not.toContain('aria-label="Value now"');
    // no health picked: Save is disabled, so a blank check-in cannot be saved
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Save check-in/);
  });
  it("a note without a health still cannot save (pinned apart from the empty-note rule)", () => {
    const html = renderToStaticMarkup(
      <CheckInFormView
        metric={false}
        unit=""
        health={null}
        note="written, but no health picked"
        value=""
        draftState={{ kind: "manual" }}
        saving={false}
        error={null}
        onHealth={() => {}}
        onNote={() => {}}
        onValue={() => {}}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Save check-in/);
  });
});
