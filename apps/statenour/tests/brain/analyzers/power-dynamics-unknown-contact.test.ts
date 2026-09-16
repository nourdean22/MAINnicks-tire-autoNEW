/**
 * power-dynamics · a person with no logged contact is UNKNOWN, not neglected
 * (2026-09-16, W6).
 *
 * After the counter reconcile, lastInteraction is NULL for every profile the
 * ledger has never seen. Every other consumer (picks, digest, /people,
 * watchlist, changes-since) already treats NULL as "no signal"; this
 * analyzer was the one place NULL read as "not contacted in 30+ days" — a
 * claim about people the operator may see daily and simply never logged.
 * With 20 of 27 profiles NULL that line would have led the guidance.
 *
 * Positive control: red before the fix (neglectedCount 2, guidance names
 * "2 connections"), green after.
 */
import { describe, expect, it } from "vitest";

import { computePowerDynamics, type PersonProfileInput } from "@/lib/brain/analyzers/power-dynamics";

const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

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

describe("computePowerDynamics · network counts", () => {
  it("NULL lastInteractionAt is neither active nor neglected, and the guidance never counts it", () => {
    const out = computePowerDynamics({
      profiles: [
        profile({ id: "unknown", name: "Mom", lastInteractionAt: null }),
        profile({ id: "active", name: "Mash", lastInteractionAt: daysAgo(3), interactionCount: 3 }),
        profile({ id: "stale", name: "Nimeh", lastInteractionAt: daysAgo(68), interactionCount: 2 }),
      ],
      ledgerEntries: [],
      playEntries: [],
      contextualLaws: [],
      xpStats: { persuasion: 0, strategy: 0, networking: 0 },
      days: 30,
    });

    expect(out.network.totalProfiles).toBe(3);
    expect(out.network.activeConnections).toBe(1);
    expect(out.network.neglectedCount).toBe(1);
    const neglectLine = out.guidance.find((g) => g.includes("not contacted in 30+ days"));
    expect(neglectLine).toBe("1 connection not contacted in 30+ days. Re-engage your top 2 this week.");
  });
});
