/**
 * people-credit tests · 2026-06-01 · statenour/people-overhaul.
 * Pins the operator's rule: REAL REPS earn XP, cataloguing/losses don't.
 * creditStatXp is mocked (proven elsewhere) — this verifies the mapping,
 * the amount gate, the xp scaling/cap, the neglect-repair bonus, and the
 * person-scoped idempotent sourceKey.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mastery/credit", () => ({
  creditStatXp: vi.fn(async () => true),
  MASTERY_XP_CATEGORY: "mastery_xp_event",
}));
// Keep resolvePeopleXp deterministic + DB-free: no override, defaults win.
vi.mock("@/lib/services/settings", () => ({
  getSetting: vi.fn(async (_key: string, dflt: unknown) => dflt),
}));
// Prisma mock for the backfill reads (no real DB in unit tests).
vi.mock("@/lib/prisma", () => ({
  prisma: {
    relationshipLedger: { findMany: vi.fn(async () => []) },
    relationshipPlay: { findMany: vi.fn(async () => []) },
    brainMemory: { findMany: vi.fn(async () => []) },
  },
}));

import {
  creditLedgerDeposit,
  creditPowerPlay,
  backfillPeopleXp,
  statForRole,
  PEOPLE_XP_DEFAULTS,
} from "@/lib/mastery/people-credit";
import { creditStatXp } from "@/lib/mastery/credit";
import { prisma } from "@/lib/prisma";

const mockCredit = vi.mocked(creditStatXp);

beforeEach(() => {
  vi.clearAllMocks();
  mockCredit.mockResolvedValue(true);
});

describe("statForRole · personal vs network", () => {
  it("personal/intimate roles → relationships", () => {
    for (const r of ["family", "friend", "close_friend", "romantic", "acquaintance"]) {
      expect(statForRole(r)).toBe("relationships");
    }
  });
  it("professional/strategic/adversarial + unknown → networking", () => {
    for (const r of ["customer", "vendor", "advisor", "competitor", "rival", "enemy", "mentor", null, undefined, "unknown"]) {
      expect(statForRole(r)).toBe("networking");
    }
  });
});

describe("creditLedgerDeposit · real reps only", () => {
  it("does NOT credit a withdrawal or zero (a loss is not a win)", async () => {
    await creditLedgerDeposit({ ledgerId: "l1", personId: "p1", amount: -50, note: "blow up" });
    await creditLedgerDeposit({ ledgerId: "l2", personId: "p1", amount: 0, note: "status flip" });
    expect(mockCredit).not.toHaveBeenCalled();
  });

  it("credits a positive deposit to the role's stat, person-scoped sourceKey", async () => {
    await creditLedgerDeposit({ ledgerId: "l3", personId: "p1", amount: 5, note: "helped move", role: "friend" });
    expect(mockCredit).toHaveBeenCalledWith(
      expect.objectContaining({
        stat: "relationships",
        signal: "decision",
        sourceKey: "person:p1:ledger:l3",
      }),
    );
    // xp = round((0.5 + 5*0.03) * 10)/10 = round(6.5)/10 = 0.7 (half-up)
    const call = mockCredit.mock.calls.find((c) => c[0].sourceKey === "person:p1:ledger:l3");
    expect(call?.[0].xp).toBeCloseTo(0.7, 5);
  });

  it("caps a huge deposit at depositMax", async () => {
    await creditLedgerDeposit({ ledgerId: "l4", personId: "p1", amount: 100, note: "saved my life", role: "vendor" });
    const call = mockCredit.mock.calls.find((c) => c[0].sourceKey === "person:p1:ledger:l4");
    expect(call?.[0].stat).toBe("networking");
    expect(call?.[0].xp).toBe(PEOPLE_XP_DEFAULTS.depositMax);
  });

  it("adds a reconnect bonus only when the bond was neglected > 14d", async () => {
    const stale = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await creditLedgerDeposit({ ledgerId: "l5", personId: "p2", amount: 2, note: "reached out", role: "friend", priorLastInteraction: stale });
    expect(mockCredit).toHaveBeenCalledWith(
      expect.objectContaining({ stat: "relationships", sourceKey: "person:p2:reconnect:l5" }),
    );

    mockCredit.mockClear();
    const fresh = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await creditLedgerDeposit({ ledgerId: "l6", personId: "p2", amount: 2, note: "quick check", role: "friend", priorLastInteraction: fresh });
    expect(mockCredit.mock.calls.some((c) => c[0].sourceKey === "person:p2:reconnect:l6")).toBe(false);
  });
});

describe("creditPowerPlay · deliberate influence reps", () => {
  it.each([
    ["arc_plan", "strategy"],
    ["message_draft", "persuasion"],
    ["scarcity_play", "seduction"],
    ["reciprocity_assess", "networking"],
  ])("%s → %s stat", async (kind, stat) => {
    await creditPowerPlay({ playId: "pl1", personId: "p3", kind });
    expect(mockCredit).toHaveBeenCalledWith(
      expect.objectContaining({ stat, xp: PEOPLE_XP_DEFAULTS.play, sourceKey: "person:p3:play:pl1" }),
    );
  });

  it("unknown kind falls back to strategy", async () => {
    await creditPowerPlay({ playId: "pl2", personId: "p3", kind: "mystery" });
    expect(mockCredit).toHaveBeenCalledWith(expect.objectContaining({ stat: "strategy" }));
  });
});

describe("backfillPeopleXp · idempotent retro-credit", () => {
  it("credits every positive deposit + every play, by role/kind", async () => {
    vi.mocked(prisma.relationshipLedger.findMany).mockResolvedValueOnce([
      { id: "l1", personId: "p1", amount: 5, note: "helped move", person: { role: "friend" } },
      { id: "l2", personId: "p2", amount: 3, note: "intro", person: { role: "vendor" } },
    ] as never);
    vi.mocked(prisma.relationshipPlay.findMany).mockResolvedValueOnce([
      { id: "pl1", personId: "p1", kind: "message_draft" },
    ] as never);

    const res = await backfillPeopleXp();
    expect(res).toEqual({ deposits: 2, plays: 1 });
    expect(mockCredit).toHaveBeenCalledWith(
      expect.objectContaining({ stat: "relationships", sourceKey: "person:p1:ledger:l1" }),
    );
    expect(mockCredit).toHaveBeenCalledWith(
      expect.objectContaining({ stat: "networking", sourceKey: "person:p2:ledger:l2" }),
    );
    expect(mockCredit).toHaveBeenCalledWith(
      expect.objectContaining({ stat: "persuasion", sourceKey: "person:p1:play:pl1" }),
    );
    // backfill must NOT credit a reconnect bonus (no historical prior timestamp)
    expect(
      mockCredit.mock.calls.some((c) => c[0].sourceKey.includes(":reconnect:")),
    ).toBe(false);
  });
});
