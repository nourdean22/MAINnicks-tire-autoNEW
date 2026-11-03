/**
 * The Goals tab's hero and milestone ladder (job 2026-11-02-nour-os-interconnect W5). Views take plain
 * data, so every state renders without a network.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GoalLadder, LADDER_PHASE_CAP } from "@/components/goals/goal-ladder";
import { GoalsHeroView, askNickAboutGoal, pulseLine } from "@/components/goals/goals-hero";

const NOW = Date.parse("2026-11-02T17:00:00Z");
const goal = {
  id: "g1",
  title: "Run a 10k",
  progress: 30,
  status: "active",
  currentValue: 3,
  targetValue: 10,
  unit: "km",
  deadline: null,
  horizon: null,
  createdAt: "2026-10-20T12:00:00.000Z",
  health: { state: "no_check_in" as const, at: null, note: null },
  nextMove: { id: "t1", title: "Book the race", status: "READY" },
};
const noop = () => {};

describe("GoalLadder", () => {
  it("shows each phase with its glyph and word: done, now, next", () => {
    const html = renderToStaticMarkup(
      <GoalLadder
        phases={[
          { name: "Scope", done: true, current: false },
          { name: "Build", done: false, current: true },
          { name: "Ship", done: false, current: false },
        ]}
      />,
    );
    expect(html).toContain("✓ Scope");
    expect(html).toContain("now: Build");
    expect(html).toContain("◌ Ship");
    expect(html).toContain("1 of 3 done");
  });

  it("caps the phases shown and says how many more", () => {
    const phases = Array.from({ length: LADDER_PHASE_CAP + 2 }, (_, i) => ({ name: `P${i}`, done: false, current: i === 0 }));
    const html = renderToStaticMarkup(<GoalLadder phases={phases} />);
    expect(html).toContain(`P${LADDER_PHASE_CAP - 1}`);
    expect(html).not.toContain(`P${LADDER_PHASE_CAP}<`);
    expect(html).toContain("+2 more");
  });

  it("no phases renders nothing (the Plan it button stays the card's door)", () => {
    expect(renderToStaticMarkup(<GoalLadder phases={[]} />)).toBe("");
  });
});

describe("GoalsHeroView", () => {
  const base = {
    goal,
    reason: "due_soonest" as const,
    pulse: { total: 3, behind: 1, offTrack: 0, checkInDue: 2 },
    maxim: null,
    moved: "Moved 2d ago",
    now: NOW,
    onOpen: noop,
    onAskNick: noop,
  };

  it("says which goal, why, the one move, and whether it moved", () => {
    const html = renderToStaticMarkup(<GoalsHeroView {...base} />);
    expect(html).toContain("Run a 10k");
    expect(html).toContain("Due soonest");
    expect(html).toContain("Next: Book the race");
    expect(html).toContain('href="/missions?taskId=t1"');
    expect(html).toContain("Moved 2d ago");
    expect(html).toContain("Ask Nick about this goal");
  });

  it("the one move is the page's gold primary; with no next move it opens the card instead", () => {
    expect(renderToStaticMarkup(<GoalsHeroView {...base} />)).toContain("bg-accent");
    const none = renderToStaticMarkup(<GoalsHeroView {...base} goal={{ ...goal, nextMove: null }} />);
    expect(none).toContain("No next step yet: add one");
    expect(none).not.toContain("taskId=");
  });

  it("a maxim shows with its source and the moment that chose it; none, no quote block", () => {
    const html = renderToStaticMarkup(
      <GoalsHeroView {...base} maxim={{ state: "check_in_due", id: "x:1", text: "Act that day.", origin: "Bezos" }} />,
    );
    expect(html).toContain("Act that day.");
    expect(html).toContain("Bezos");
    expect(html).toContain("check-in due");
    expect(renderToStaticMarkup(<GoalsHeroView {...base} />)).not.toContain("<blockquote");
  });

  it("every control carries the 44 px floor", () => {
    const html = renderToStaticMarkup(<GoalsHeroView {...base} />);
    const controls = html.match(/<(a|button)\b[^>]*>/g) ?? [];
    expect(controls.length).toBeGreaterThanOrEqual(3);
    for (const c of controls) expect(c).toMatch(/min-h-11/);
  });
});

describe("pulseLine", () => {
  it("names only what needs him, and says so when nothing does", () => {
    expect(pulseLine({ total: 3, behind: 1, offTrack: 1, checkInDue: 2 })).toBe("3 goals · 1 off track · 1 behind · 2 need a check-in");
    expect(pulseLine({ total: 1, behind: 0, offTrack: 0, checkInDue: 0 })).toBe("1 goal · none behind");
  });
});

describe("askNickAboutGoal", () => {
  it("prefills a question that carries the goal id, never sends it", () => {
    const events: CustomEvent[] = [];
    const target = { dispatchEvent: (e: Event) => (events.push(e as CustomEvent), true) };
    askNickAboutGoal({ id: "g1", title: "Run a 10k" }, target);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("statenour:open-nick");
    expect(events[0]!.detail.pendingPrompt).toContain("[id:g1]");
    expect(events[0]!.detail.pendingPrompt).toContain("Run a 10k");
    expect(events[0]!.detail.submitOnMount).toBe(false);
  });
});
