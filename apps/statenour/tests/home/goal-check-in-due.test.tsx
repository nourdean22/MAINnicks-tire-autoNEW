/**
 * Home "check-in due" row (job 2026-11-02-nour-os-interconnect W2, Linear L3) and the "Nick remembers"
 * read (map gap 6). Both are reads that render: a failed read is "couldn't read", never a quiet empty.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({
  goalFindMany: vi.fn(),
  eventFindMany: vi.fn(),
  auditFindMany: vi.fn(),
  anticipated: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    lifeGoal: { findMany: h.goalFindMany },
    goalEvent: { findMany: h.eventFindMany },
    auditEvent: { findMany: h.auditFindMany },
  },
}));
vi.mock("@/lib/brain/anticipated-questions", () => ({ getTodaysAnticipated: h.anticipated }));
vi.mock("@/lib/services/outcome-ledger", () => ({ recordShownBounded: vi.fn(async () => "led") }));

import { GoalsCardView } from "@/components/home/home-cards";
import { __testInternals } from "@/lib/home/operator-brief";
import { readNickRemembers } from "@/lib/home/nick-remembers";
import { remembersFailedLine } from "@/components/home/nick-command-line";

const DAY = 86_400_000;
const NOW = new Date("2026-11-02T15:00:00Z");
const READ = { title: "Save $15k", label: "40d left", active: 3 };

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
});

describe("loadGoalCheckInDue (the brief's read)", () => {
  it("returns the most overdue active goal from the check-in events", async () => {
    h.goalFindMany.mockResolvedValue([
      { id: "g1", title: "Week goal", horizon: "WEEK", createdAt: new Date(NOW.getTime() - 40 * DAY) },
      { id: "g2", title: "Month goal", horizon: "MONTH", createdAt: new Date(NOW.getTime() - 50 * DAY) },
    ]);
    h.eventFindMany.mockResolvedValue([{ goalId: "g1", createdAt: new Date(NOW.getTime() - 1 * DAY) }]);
    expect(await __testInternals.loadGoalCheckInDue(NOW)).toEqual({ goalId: "g2", title: "Month goal", daysOverdue: 20 });
  });

  it("a failed check-in read is 'unknown', never null (null means nothing is due)", async () => {
    h.goalFindMany.mockResolvedValue([{ id: "g1", title: "Week goal", horizon: "WEEK", createdAt: new Date(NOW.getTime() - 40 * DAY) }]);
    h.eventFindMany.mockRejectedValue(new Error("timeout"));
    expect(await __testInternals.loadGoalCheckInDue(NOW)).toBe("unknown");
  });
});

describe("the Goals card's check-in row", () => {
  it("names the due goal and links to the goals tab", () => {
    const html = renderToStaticMarkup(<GoalsCardView read={READ} checkIn={{ goalId: "g2", title: "Month goal", daysOverdue: 20 }} />);
    expect(html).toContain("Check-in due: Month goal");
    expect(html).toContain('href="/stats?tab=goals"');
  });
  it("a failed check-in read shows the card's unknown line", () => {
    const html = renderToStaticMarkup(<GoalsCardView read={READ} checkIn="unknown" />);
    expect(html).toMatch(/Check-in unknown, couldn.*t load/);
  });
  it("nothing due shows no row", () => {
    expect(renderToStaticMarkup(<GoalsCardView read={READ} checkIn={null} />)).not.toContain("Check-in");
  });
});

describe("readNickRemembers (map gap 6)", () => {
  it("a failed digest read is named in failed, not an empty follow-up list", async () => {
    h.anticipated.mockResolvedValue(null);
    h.auditFindMany.mockRejectedValue(new Error("db down"));
    const r = await readNickRemembers();
    expect(r.failed).toEqual(["conversation digests"]);
    expect(r.followUps).toEqual([]);
  });
  it("a failed anticipated read is named too; a measured empty day has failed = []", async () => {
    h.anticipated.mockRejectedValue(new Error("x"));
    h.auditFindMany.mockResolvedValue([{ payload: { followUpNeeded: " call the bank " } }]);
    const r = await readNickRemembers();
    expect(r.failed).toEqual(["anticipated questions"]);
    expect(r.followUps).toEqual(["call the bank"]);
    h.anticipated.mockResolvedValue(null);
    expect((await readNickRemembers()).failed).toEqual([]);
  });
  it("the command line says it couldn't read, and stays quiet on a clean read", () => {
    expect(remembersFailedLine({ failed: ["conversation digests"] }, false)).toBe("Couldn't read what Nick remembers (conversation digests)");
    expect(remembersFailedLine(undefined, true)).toBe("Couldn't read what Nick remembers");
    expect(remembersFailedLine({ failed: [] }, false)).toBeNull();
    expect(remembersFailedLine(undefined, false)).toBeNull();
  });
});
