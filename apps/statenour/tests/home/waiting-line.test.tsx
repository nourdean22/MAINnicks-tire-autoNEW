/**
 * tests/home/waiting-line.test.tsx · 2026-10-02 · full-circle wave 2
 *
 * The Home rail's "waiting on others" line over the WaitingSummary read
 * model. Pinned: a measured zero renders NOTHING; a failed read renders
 * unknown with the failed source NAMED, never an empty list; the operator's
 * own decisions (me) are not re-listed here; shop items never reach Home;
 * rows are capped with the remainder counted behind /missions.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { WaitingItem, WaitingSummary } from "@/lib/home/waiting-summary";
import {
  WAITING_LINE_ROW_CAP,
  WaitingLineView,
  formatWaitingAge,
  waitingLineModel,
} from "@/components/home/waiting-line";

const item = (over: Partial<WaitingItem> & { key: string }): WaitingItem => ({
  owner: "others",
  subject: "Quote from Dania",
  who: "Dania",
  since: "2026-09-30T12:00:00Z",
  ageMin: 2_880,
  deadline: null,
  consequence: null,
  nextAction: "nudge",
  href: "/missions",
  source: "tasks k2",
  ...over,
});

const summary = (over: Partial<WaitingSummary> = {}): WaitingSummary => ({
  measuredAt: "2026-10-02T12:00:00Z",
  scope: "statenour",
  me: { items: [item({ key: "request:r1", owner: "me", who: "you", subject: "approve x" })], count: 1 },
  others: { items: [], count: 0 },
  system: { items: [], count: 0 },
  failedSources: [],
  staleSources: [],
  partial: false,
  ...over,
});

describe("waitingLineModel", () => {
  it("a measured zero is nothing — the me bucket alone never makes this section appear", () => {
    expect(waitingLineModel(summary(), "ready").kind).toBe("nothing");
    expect(renderToStaticMarkup(<WaitingLineView summary={summary()} status="ready" />)).toBe("");
  });

  it("loading renders nothing (no skeleton churn in the rail)", () => {
    expect(waitingLineModel(null, "loading").kind).toBe("nothing");
  });

  it("a failed first read is unknown, and says so", () => {
    const html = renderToStaticMarkup(<WaitingLineView summary={null} status="error" />);
    expect(html).toContain("unknown");
    expect(html).toContain("read failed");
    expect(html).not.toContain("<ul");
  });

  it("a failed tasks read makes the section unknown with the source named, even when system is countable", () => {
    const s = summary({ others: { items: [], count: null }, failedSources: ["tasks"] });
    const m = waitingLineModel(s, "ready");
    expect(m.kind).toBe("unknown");
    expect(m.failedSources).toEqual(["tasks"]);
    expect(renderToStaticMarkup(<WaitingLineView summary={s} status="ready" />)).toContain("tasks");
  });

  it("rows are oldest first, others and system together, capped with the remainder counted", () => {
    const others = Array.from({ length: 5 }, (_, i) =>
      item({ key: `task:o${i}`, who: `P${i}`, ageMin: 100 * (i + 1) }),
    );
    const system = [item({ key: "task:n1", owner: "system", who: "Nick", subject: "Draft email", ageMin: 10_000 })];
    const s = summary({ others: { items: others, count: 5 }, system: { items: system, count: 1 } });
    const m = waitingLineModel(s, "ready");
    expect(m.kind).toBe("rows");
    expect(m.total).toBe(6);
    expect(m.rows).toHaveLength(WAITING_LINE_ROW_CAP);
    expect(m.rows[0].key).toBe("task:n1");
    expect(m.more).toBe(6 - WAITING_LINE_ROW_CAP);
    const html = renderToStaticMarkup(<WaitingLineView summary={s} status="ready" />);
    expect(html).toContain("Nick");
    expect(html).toContain("6d");
    expect(html).toContain(`+${6 - WAITING_LINE_ROW_CAP} more`);
    expect(html).not.toContain("approve x");
  });

  it("a shop-bridge item never reaches Home, whatever bucket it arrives in", () => {
    const s = summary({
      others: { items: [item({ key: "callback:17", who: "Sam", source: "nickstire callback_requests 17" })], count: 1 },
    });
    const m = waitingLineModel(s, "ready");
    expect(m.rows).toEqual([]);
    expect(renderToStaticMarkup(<WaitingLineView summary={s} status="ready" />)).not.toContain("Sam");
  });

  it("a deadline rides the age column", () => {
    const s = summary({ others: { items: [item({ key: "task:k2", deadline: "2026-09-30", ageMin: 90 })], count: 1 } });
    const html = renderToStaticMarkup(<WaitingLineView summary={s} status="ready" />);
    expect(html).toContain("1h");
    expect(html).toContain("due 2026-09-30");
  });
});

describe("formatWaitingAge", () => {
  it("minutes, hours, days, and an honest unknown", () => {
    expect(formatWaitingAge(5)).toBe("5m");
    expect(formatWaitingAge(125)).toBe("2h");
    expect(formatWaitingAge(2_880)).toBe("2d");
    expect(formatWaitingAge(null)).toBe("age unknown");
  });
});
