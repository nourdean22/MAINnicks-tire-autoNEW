/**
 * W6 PR 2 · "plus any more too": the six reads the starter intents need had no card, so /now could not
 * show tasks, missions, commitments, people, the calendar or habits. Each is now a typed registry entry.
 * Fixtures copy each producer's real return (file named per case). A shape that drifts draws no body;
 * the calendar's not-connected answer reads as a failure with its reason, never as "no events".
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/trpc/client", () => {
  const hookLeaf = { useMutation: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }) };
  const procProxy = new Proxy({}, { get: () => hookLeaf });
  return { trpc: new Proxy({}, { get: () => procProxy }) };
});
vi.spyOn(console, "warn").mockImplementation(() => {});

import { ToolResultCard } from "@/components/chat/tool-result-card";
import { TOOL_CONFIG, isKnownToolName } from "@/components/chat/tool-result-registry";

const card = (toolName: string, output: unknown) =>
  renderToStaticMarkup(<ToolResultCard toolName={toolName} state="output-available" output={output} />).replace(/<!-- -->/g, "");

const CASES = {
  // lib/ai/tools/tasks.ts getTasks: prisma rows, dates arrive as JSON strings.
  getTasks: {
    good: [
      { id: "t1", title: "Order brake pads for the Camry", status: "READY", dueDate: "2026-11-03T00:00:00.000Z", mission: { title: "Shop", domain: "BUSINESS" } },
      { id: "t2", title: "Call the tire supplier", status: "DOING", dueDate: null, mission: null },
    ],
    expect: ["Tasks read", "2 open", "Order brake pads for the Camry", "Call the tire supplier", "Shop"],
    drifted: [{ id: "t1", title: 42 }],
  },
  // lib/ai/tools/missions.ts getMissions
  getMissions: {
    good: [{ id: "m1", title: "Hire a second tech", domain: "BUSINESS", priority: 3, status: "ACTIVE", systemKind: null }],
    expect: ["Missions read", "1 active", "Hire a second tech"],
    drifted: { missions: "not a list" },
  },
  // lib/ai/tools/tasks.ts getCommitments: prisma Commitment rows
  getCommitments: {
    good: [{ id: 4, dateMade: "2026-10-30", toWhom: "Mash", description: "Send the alignment quote", deadline: "2026-11-02", status: "active" }],
    expect: ["Commitments read", "1 active", "Send the alignment quote", "Mash"],
    drifted: [{ id: 4, description: null }],
  },
  // lib/ai/tools/tasks.ts getRelationshipPicks
  getRelationshipPicks: {
    good: { picks: [{ personId: "p1", name: "Manny", why: "Quiet for 12 days", daysQuiet: 12, openPromises: 1, seeingOn: null, maxim: null }], source: "engine", calendar: "ok" },
    expect: ["People to reach", "1 today", "Manny", "Quiet for 12 days"],
    drifted: { picks: [{ name: { first: "Manny" } }] },
  },
  // lib/ai/tools/calendar.ts readSchedule (success)
  getTodaySchedule: {
    good: { ok: true, count: 1, unreadableAccounts: [], events: [{ id: "e1", summary: "Supplier call", start: "2026-11-02T14:00:00.000Z", end: "2026-11-02T14:30:00.000Z", allDay: false, location: null, attendees: [], link: null }] },
    expect: ["Calendar read", "1 event", "Supplier call"],
    drifted: { ok: true, events: [{ summary: 7 }] },
  },
  // lib/ai/tools/habits.ts getHabitStreaks: title -> 7-day window
  getHabitStreaks: {
    good: { Workout: { completed: 5, total: 7 }, Journal: { completed: 2, total: 7 } },
    expect: ["Habits read", "2 habits", "Workout", "5 of 7 days", "Journal"],
    drifted: { Workout: { completed: "most" } },
  },
} as const;

describe("the six intent reads are registered typed cards", () => {
  for (const [tool, c] of Object.entries(CASES)) {
    it(`${tool}: registered with an output schema`, () => {
      expect(isKnownToolName(tool)).toBe(true);
      expect(TOOL_CONFIG[tool]?.outputSchema).toBeDefined();
    });

    it(`${tool}: a real-shaped output draws its rows`, () => {
      const markup = card(tool, c.good);
      for (const text of c.expect) expect(markup).toContain(text);
      expect(markup).toContain(`data-testid="intent-rows-${tool}"`);
    });

    it(`${tool}: a drifted output draws no rows and never throws`, () => {
      const markup = card(tool, c.drifted);
      expect(markup).not.toContain(`data-testid="intent-rows-${tool}"`);
    });
  }

  it("the calendar's not-connected answer is a failure with its reason, not an empty day", () => {
    const markup = card("getTodaySchedule", { ok: false, code: "not_connected", error: "His calendar is not connected. Connect nourdean22 via the settings page." });
    expect(markup).toContain("Not done");
    expect(markup).toContain("His calendar is not connected");
    expect(markup).not.toContain('data-testid="intent-rows-getTodaySchedule"');
  });

  it("a long list draws five rows and says how many more", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, title: `Task number ${i}`, status: "READY", dueDate: null, mission: null }));
    const markup = card("getTasks", many);
    expect(markup).toContain("Task number 4");
    expect(markup).not.toContain("Task number 5");
    expect(markup).toContain("3 more");
  });
});
