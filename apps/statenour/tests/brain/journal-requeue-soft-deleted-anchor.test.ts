/**
 * Re-grounding fires on the delete path the app actually uses
 * (audit 2026-10-10, 05-M11).
 *
 * PR #2890's sweep reset journal rows whose link claimed a goal/mission with
 * a NULL FK — the hard-delete shape. The app SOFT-deletes goals
 * (goals.ts removeGoal) and missions (missions.ts), so the FK stays set and
 * the sweep never matched. It now also matches a row whose goal or mission
 * has deletedAt set. And re-grounding must not pick the deleted mission
 * again (soft delete leaves status ACTIVE), or the row loops every night.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const t = () => ({ findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() });
  return {
    prisma: {
      brainDump: t(),
      reflection: t(),
      situationLog: t(),
      decisionReplay: t(),
      lifeGoal: t(),
      mission: t(),
    },
    aiChat: vi.fn(),
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => h.aiChat }));
vi.mock("@/lib/journal/settings", () => ({
  getJournalSettings: vi.fn(async () => ({ creativeIntensity: "off", challengeCadence: "off" })),
}));
vi.mock("@/lib/brain/memory-admission", () => ({ admitMemory: vi.fn() }));

import { enrichJournalEntry, requeueDanglingLinks } from "@/lib/brain/journal-brain";

beforeEach(() => {
  vi.clearAllMocks();
  for (const table of Object.values(h.prisma)) {
    table.findMany.mockResolvedValue([]);
    table.updateMany.mockResolvedValue({ count: 0 });
    table.update.mockResolvedValue({});
  }
  h.aiChat.mockResolvedValue({ content: "{}", provider: "ollama" });
});

type Where = { linkStatus: unknown; OR: Array<Record<string, unknown>> };

describe("requeueDanglingLinks · soft-deleted anchors", () => {
  it("matches a claimed link whose goal or mission is soft-deleted, and still the NULL-FK shape", async () => {
    h.prisma.decisionReplay.updateMany.mockResolvedValue({ count: 4 });

    expect(await requeueDanglingLinks("decision_replay")).toBe(4);

    const where = h.prisma.decisionReplay.updateMany.mock.calls[0][0].where as Where;
    expect(where.linkStatus).toEqual({ in: ["auto", "proposed", "confirmed"] });
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { goalId: null, missionId: null },
        { goal: { is: { deletedAt: { not: null } } } },
        { mission: { is: { deletedAt: { not: null } } } },
      ]),
    );
  });

  it("every silo gets the same predicate (each has goal + mission relations)", async () => {
    for (const silo of ["brain_dump", "reflection", "situation_log"] as const) {
      await requeueDanglingLinks(silo);
    }
    for (const t of [h.prisma.brainDump, h.prisma.reflection, h.prisma.situationLog]) {
      expect((t.updateMany.mock.calls[0][0].where as Where).OR).toHaveLength(3);
    }
  });
});

describe("enrichJournalEntry · re-grounding never offers a soft-deleted anchor", () => {
  it("the mission candidate list filters deletedAt (goals already did)", async () => {
    await enrichJournalEntry("decision_replay", "dec-1", "Bringing Jason back as a tech next week");

    // POSITIVE CONTROL: grounding ran and read both candidate lists.
    expect(h.prisma.lifeGoal.findMany.mock.calls[0][0].where).toMatchObject({ deletedAt: null });
    expect(h.prisma.mission.findMany.mock.calls[0][0].where).toMatchObject({ status: "ACTIVE", deletedAt: null });
  });
});
