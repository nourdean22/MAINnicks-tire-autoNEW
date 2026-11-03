/**
 * W7 (job 2026-11-02-nour-os-interconnect, Tana T3) · the journal's day view: what got DONE that day (task
 * completions, with their goal) and who he was in contact with (relationship-ledger contact rows). The day is an
 * America/New_York calendar day; each read fails on its own and is named, never shown as an empty day.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({ events: vi.fn(), ledger: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { taskEvent: { findMany: h.events }, relationshipLedger: { findMany: h.ledger } },
}));
const logWarn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logger", async (orig) => {
  const m = await orig<typeof import("@/lib/logger")>();
  return { ...m, logger: { ...m.logger, withSurface: (s: string) => ({ ...m.logger.withSurface(s), warn: logWarn }) } };
});

import { dayActivity, etDayBounds } from "@/lib/services/journal-day";
import { DayActivityPanel } from "@/components/journal/day-activity";

const ev = (id: string, taskId: string, title: string, over: Record<string, unknown> = {}) => ({
  id,
  createdAt: new Date("2026-11-02T15:00:00Z"),
  task: { id: taskId, title, goal: null, mission: { lifeGoal: { id: "g-m", title: "Grow the shop", deletedAt: null } } },
  ...over,
});
const row = (id: string, metadata: unknown = null, person = { id: "p1", name: "Dania", deletedAt: null }) => ({
  id,
  note: `note ${id}`,
  source: "manual",
  createdAt: new Date("2026-11-02T16:00:00Z"),
  metadata,
  person,
});

beforeEach(() => {
  h.events.mockReset();
  h.ledger.mockReset();
  logWarn.mockReset();
});

describe("etDayBounds", () => {
  it("is ET midnight to ET midnight, across both DST offsets", () => {
    expect(etDayBounds("2026-11-02")).toEqual({ start: new Date("2026-11-02T05:00:00Z"), end: new Date("2026-11-03T05:00:00Z") });
    expect(etDayBounds("2026-07-04")).toEqual({ start: new Date("2026-07-04T04:00:00Z"), end: new Date("2026-07-05T04:00:00Z") });
    // The DST end day is 25 hours long.
    const { start, end } = etDayBounds("2026-11-01");
    expect(end.getTime() - start.getTime()).toBe(25 * 3_600_000);
  });

  it("refuses anything but a YYYY-MM-DD date", () => {
    expect(() => etDayBounds("2026-11-2")).toThrow();
    expect(() => etDayBounds("2026-13-01")).toThrow();
  });
});

describe("dayActivity", () => {
  it("reads completions and contacts inside the ET day, each task once, with its goal", async () => {
    h.events.mockResolvedValue([
      ev("e1", "t1", "Call the supplier", { task: { id: "t1", title: "Call the supplier", goal: { id: "g-t", title: "Save $15k", deletedAt: null }, mission: null } }),
      ev("e2", "t2", "Sweep the bay"),
      ev("e3", "t1", "Call the supplier"),
    ]);
    h.ledger.mockResolvedValue([row("l1")]);
    const day = await dayActivity("2026-11-02");

    const bounds = { gte: new Date("2026-11-02T05:00:00Z"), lt: new Date("2026-11-03T05:00:00Z") };
    expect(h.events.mock.calls[0][0].where).toEqual({ kind: "completed", createdAt: bounds });
    expect(h.ledger.mock.calls[0][0].where).toEqual({ createdAt: bounds });
    expect(day.failed).toEqual([]);
    expect(day.tasksDone).toEqual([
      { taskId: "t1", title: "Call the supplier", at: "2026-11-02T15:00:00.000Z", goal: { id: "g-t", title: "Save $15k" } },
      { taskId: "t2", title: "Sweep the bay", at: "2026-11-02T15:00:00.000Z", goal: { id: "g-m", title: "Grow the shop" } },
    ]);
    expect(day.contacts).toEqual([
      { id: "l1", person: { id: "p1", name: "Dania" }, note: "note l1", source: "manual", at: "2026-11-02T16:00:00.000Z" },
    ]);
  });

  it("drops non-contact ledger rows (a mention or a status flip) and rows of a deleted person", async () => {
    h.events.mockResolvedValue([]);
    h.ledger.mockResolvedValue([
      row("keep", null),
      row("synthetic", { synthetic: true }),
      row("flip", { kind: "status_flip" }),
      row("gone", null, { id: "p9", name: "Old", deletedAt: new Date() } as never),
    ]);
    expect((await dayActivity("2026-11-02")).contacts.map((c) => c.id)).toEqual(["keep"]);
  });

  it("a failed read is named; the other read still lands", async () => {
    h.events.mockRejectedValue(new Error("tasks down"));
    h.ledger.mockResolvedValue([row("l1")]);
    const day = await dayActivity("2026-11-02");
    expect(day.failed).toEqual(["tasks"]);
    expect(day.contacts).toHaveLength(1);
    expect(logWarn).toHaveBeenCalledWith("day_read_failed", expect.objectContaining({ read: "tasks", err: "tasks down" }));

    h.events.mockResolvedValue([]);
    h.ledger.mockRejectedValue(new Error("ledger down"));
    expect((await dayActivity("2026-11-02")).failed).toEqual(["contacts"]);
  });
});

describe("DayActivityPanel", () => {
  const base = { date: "2026-11-02", tasksDone: [], contacts: [], failed: [] as string[] };

  it("lists done tasks with their goal and contacts with the person's dossier link", () => {
    const html = renderToStaticMarkup(
      <DayActivityPanel
        read={{
          ...base,
          tasksDone: [{ taskId: "t1", title: "Call the supplier", at: "2026-11-02T15:00:00.000Z", goal: { id: "g1", title: "Save $15k" } }],
          contacts: [{ id: "l1", person: { id: "p1", name: "Dania" }, note: "Lunch", source: "manual", at: "2026-11-02T16:00:00.000Z" }],
        }}
      />,
    );
    expect(html).toContain("Call the supplier");
    expect(html).toContain("Save $15k");
    expect(html).toContain("/people?inspect=person:p1");
    expect(html).toContain("Lunch");
  });

  it("names a failed read instead of saying nothing happened", () => {
    const html = renderToStaticMarkup(<DayActivityPanel read={{ ...base, failed: ["tasks"] }} />);
    expect(html).toContain("Done tasks couldn&#x27;t load");
    expect(html).not.toContain("Nothing done");
  });

  it("a measured empty day says so; a whole failed query says unknown", () => {
    expect(renderToStaticMarkup(<DayActivityPanel read={base} />)).toContain("No tasks done and no contacts logged");
    expect(renderToStaticMarkup(<DayActivityPanel read="failed" />)).toContain("couldn&#x27;t load");
  });
});
