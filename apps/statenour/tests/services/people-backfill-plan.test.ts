/**
 * People W1 backfill planner (2026-10-30): pure functions, no DB, no model.
 *
 * The planner decides what a backfill WOULD write; the script prints counts
 * and a confirm token, and an apply must present the same token, so it can
 * only write the plan that was reviewed. Rules it enforces:
 *  - exact or case-insensitive names only, never a fuzzy guess;
 *  - never creates a person;
 *  - an "interacted" verdict only, never a bare mention;
 *  - no row where the ledger already holds one for that person inside the
 *    conversation's window (same rule as recordInteractionOnce), and no row
 *    twice for the same conversation and person.
 */
import { describe, expect, it } from "vitest";

import {
  matchPersonExact,
  planChatInteractions,
  planPromiseLinks,
  planToken,
} from "@/lib/services/people/backfill-plan";

const people = [
  { id: "p1", name: "Sam Rivers" },
  { id: "p2", name: "Ana" },
];

describe("matchPersonExact", () => {
  it("matches exact and case-insensitive, trims, refuses near misses", () => {
    expect(matchPersonExact("Sam Rivers", people)?.id).toBe("p1");
    expect(matchPersonExact("  ana ", people)?.id).toBe("p2");
    expect(matchPersonExact("Anna", people)).toBeNull();
    expect(matchPersonExact("Sam", people)).toBeNull();
  });

  it("refuses an ambiguous name that matches two profiles", () => {
    expect(matchPersonExact("ana", [...people, { id: "p3", name: "ANA" }])).toBeNull();
  });
});

describe("planPromiseLinks", () => {
  it("links unlinked promise tasks to an exact-named person and skips the rest", () => {
    const plan = planPromiseLinks(
      [
        { id: "t1", personId: null, promiseTo: "sam rivers" },
        { id: "t2", personId: "p9", promiseTo: "Ana" },
        { id: "t3", personId: null, promiseTo: "myself" },
        { id: "t4", personId: null, promiseTo: "Someone New" },
        { id: "t5", personId: null, promiseTo: null },
      ],
      people,
    );
    expect(plan.rows).toEqual([{ taskId: "t1", personId: "p1" }]);
    expect(plan.untrackedNames).toBe(1);
  });
});

describe("planChatInteractions", () => {
  const conv = (id: string, start: string, end: string, people: Array<{ name: string; interacted: boolean; kind?: string }>) => ({
    conversationId: id,
    start: new Date(start),
    end: new Date(end),
    mentioned: people.map((p) => ({ name: p.name, interacted: p.interacted, interactionKind: p.kind ?? null })),
  });

  it("plans one row per interacted, matched person, dated by the conversation end", () => {
    const plan = planChatInteractions(
      [conv("c1", "2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z", [
        { name: "Sam Rivers", interacted: true, kind: "call" },
        { name: "Ana", interacted: false },
        { name: "Stranger", interacted: true },
      ])],
      people,
      [],
    );
    expect(plan.rows).toEqual([
      {
        personId: "p1",
        conversationId: "c1",
        at: new Date("2026-06-01T11:00:00Z"),
        interactionKind: "call",
        backfillKey: "bf:chat:c1:p1",
      },
    ]);
    expect(plan.skipped).toEqual({ mentionOnly: 1, unmatched: 1, alreadyLogged: 0, duplicate: 0 });
  });

  it("skips a person the ledger already logged inside the conversation window", () => {
    const plan = planChatInteractions(
      [conv("c1", "2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z", [{ name: "Ana", interacted: true }])],
      people,
      [{ personId: "p2", createdAt: new Date("2026-06-01T10:30:00Z") }],
    );
    expect(plan.rows).toHaveLength(0);
    expect(plan.skipped.alreadyLogged).toBe(1);
  });

  it("a ledger row outside the window does not block", () => {
    const plan = planChatInteractions(
      [conv("c1", "2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z", [{ name: "Ana", interacted: true }])],
      people,
      [{ personId: "p2", createdAt: new Date("2026-05-20T10:30:00Z") }],
    );
    expect(plan.rows).toHaveLength(1);
  });

  it("the same person twice in one conversation is one row", () => {
    const plan = planChatInteractions(
      [conv("c1", "2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z", [
        { name: "Ana", interacted: true },
        { name: "ana", interacted: true },
      ])],
      people,
      [],
    );
    expect(plan.rows).toHaveLength(1);
    expect(plan.skipped.duplicate).toBe(1);
  });
});

describe("planToken", () => {
  it("is stable under reordering and changes when the plan changes", () => {
    const a = planToken({ chat: [{ backfillKey: "bf:chat:c1:p1" }], tasks: [{ taskId: "t1", personId: "p1" }] });
    const b = planToken({ chat: [{ backfillKey: "bf:chat:c1:p1" }], tasks: [{ taskId: "t1", personId: "p1" }] });
    const c = planToken({ chat: [], tasks: [{ taskId: "t1", personId: "p1" }] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });
});
