/**
 * power-dynamics · `unstableAlliances` read trust on the wrong scale
 * (2026-09-16, W8 · Codex follow-up on #2348).
 *
 * `trustScore` is a 0–1 Float (`prisma/schema.prisma` `@default(0.5) // 0-1`;
 * measured on prod 2026-09-16: min 0.3, max 0.9, mean 0.585). The filter
 * compared it to `50`, so the trust half of the condition was VACUOUSLY TRUE
 * for every person who has ever existed — the list was really just "anyone
 * with interactionCount >= 10", and it silently called high-trust allies
 * unstable whenever that count was reachable.
 *
 * The count half broke in the opposite direction after the counter reconcile:
 * with honest counters the prod maximum is 4 and NOBODY reaches 10, so the
 * list is now permanently empty. A threshold no row can reach is not a
 * conservative filter, it is a dead rule — and 27 of 27 profiles were checked
 * against it.
 *
 * The repair keeps the concept (real relationship + low trust) and makes both
 * halves reachable and honest: trust below the house RISK tier (< 0.4 —
 * `brain-graph.ts:605`, and the `/people` "low" band), and at least one
 * LOGGED contact, because without one the trust number is a seeded default,
 * not a judgment.
 *
 * Positive control: on the unfixed code case 1 is RED (Dania listed at trust
 * 0.9) and case 2 is RED (Manny missing at trust 0.3 with 2 contacts).
 */
import { describe, expect, it } from "vitest";

import { computePowerDynamics, type PersonProfileInput } from "@/lib/brain/analyzers/power-dynamics";

function profile(over: Partial<PersonProfileInput> & { id: string; name: string }): PersonProfileInput {
  return {
    role: "friend",
    status: "active",
    trustScore: 0.6,
    powerBalance: 0,
    interactionCount: 0,
    metadata: null,
    lastInteractionAt: null,
    ...over,
  };
}

function run(profiles: PersonProfileInput[]) {
  return computePowerDynamics({
    profiles,
    ledgerEntries: [],
    playEntries: [],
    contextualLaws: [],
    xpStats: { persuasion: 0, strategy: 0, networking: 0 },
    days: 30,
    now: new Date("2026-09-16T12:00:00Z"),
  });
}

describe("computePowerDynamics · unstableAlliances reads trust on the 0–1 scale", () => {
  it("a HIGH-trust person is never an unstable alliance, however often they are logged", () => {
    const out = run([
      profile({ id: "dania", name: "Dania", trustScore: 0.9, interactionCount: 12 }),
      profile({ id: "b", name: "B", trustScore: 0.8, interactionCount: 4 }),
      profile({ id: "c", name: "C", trustScore: 0.7, interactionCount: 1 }),
    ]);
    expect(out.threats.unstableAlliances).not.toContain("Dania");
    expect(out.threats.unstableAlliances).toEqual([]);
  });

  it("a LOW-trust person with real logged contact IS one, at the counts honest counters actually reach", () => {
    const out = run([
      profile({ id: "manny", name: "Manny", trustScore: 0.3, interactionCount: 2 }),
      profile({ id: "b", name: "B", trustScore: 0.8, interactionCount: 4 }),
      profile({ id: "c", name: "C", trustScore: 0.6, interactionCount: 1 }),
    ]);
    expect(out.threats.unstableAlliances).toEqual(["Manny"]);
  });

  it("low trust with NO logged contact is not an alliance at all — the trust number is a default, not a judgment", () => {
    const out = run([
      profile({ id: "never", name: "Never Logged", trustScore: 0.3, interactionCount: 0 }),
      profile({ id: "b", name: "B", trustScore: 0.8, interactionCount: 2 }),
      profile({ id: "c", name: "C", trustScore: 0.6, interactionCount: 1 }),
    ]);
    expect(out.threats.unstableAlliances).toEqual([]);
  });

  it("a NULL trustScore is unknown, not low", () => {
    const out = run([
      profile({ id: "unknown", name: "Unknown", trustScore: null, interactionCount: 3 }),
      profile({ id: "b", name: "B", trustScore: 0.8, interactionCount: 2 }),
      profile({ id: "c", name: "C", trustScore: 0.6, interactionCount: 1 }),
    ]);
    expect(out.threats.unstableAlliances).toEqual([]);
  });
});
