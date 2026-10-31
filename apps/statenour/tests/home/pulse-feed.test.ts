/**
 * The Pulse sheet's read model (home-pulse W3, 2026-10-31): coach events grouped by where they come
 * from, most urgent group first, each item carrying its key (for done/snooze), why-now line and link.
 */
import { describe, it, expect } from "vitest";
import { pulseFeedFrom, PULSE_SOURCE_ORDER } from "@/lib/home/pulse-feed";
import type { CoachEvent } from "@/lib/services/coach-events-types";

const ev = (over: Partial<CoachEvent>): CoachEvent => ({
  eventId: "e",
  kind: "system-alert",
  subjectId: "s",
  priority: "P2",
  title: "t",
  surfaces: ["home"],
  dismissable: true,
  extra: {},
  createdAt: "2026-10-31T10:00:00Z",
  updatedAt: "2026-10-31T10:00:00Z",
  ...over,
});

describe("pulseFeedFrom", () => {
  it("groups by source, orders groups by their most urgent item, and keeps the key for actions", () => {
    const feed = pulseFeedFrom([
      ev({ kind: "goal-pace-shift", subjectId: "g1", priority: "P2", title: "Goal slipping", body: "Two weeks behind pace", deepLink: "/stats?tab=goals" }),
      ev({ kind: "system-alert", subjectId: "cost", priority: "P0", title: "Spend over budget" }),
      ev({ kind: "prune-candidate", subjectId: "g2", priority: "P1", title: "Drop this goal?" }),
    ]);
    expect(feed.total).toBe(3);
    expect(feed.groups.map((g) => g.source)).toEqual(["system", "goals"]);
    const goals = feed.groups[1];
    expect(goals.items.map((i) => i.title)).toEqual(["Drop this goal?", "Goal slipping"]);
    expect(goals.items[1]).toMatchObject({
      key: "coach:goal-pace-shift:g1",
      whyNow: "Two weeks behind pace",
      href: "/stats?tab=goals",
      level: "P2",
    });
  });

  it("every coach kind maps to a known source, so nothing lands in an unnamed group", () => {
    const kinds: CoachEvent["kind"][] = [
      "prune-candidate", "drift-recovery", "idle-nudge", "goal-pace-shift",
      "mission-deadline-check", "proactive-nick", "anomaly", "system-alert", "held-notification",
    ];
    for (const kind of kinds) {
      const [group] = pulseFeedFrom([ev({ kind })]).groups;
      expect(PULSE_SOURCE_ORDER).toContain(group.source);
    }
  });

  it("a push held by quiet hours groups under 'held', apart from real system alerts (W4)", () => {
    const feed = pulseFeedFrom([ev({ kind: "held-notification", subjectId: "estimate-aging", title: "Estimate aging 48h" })]);
    expect(feed.groups.map((g) => g.source)).toEqual(["held"]);
  });

  it("an empty read is an empty feed (all clear), distinct from a failed read, which throws upstream", () => {
    expect(pulseFeedFrom([])).toEqual({ total: 0, groups: [] });
  });
});
