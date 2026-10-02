/**
 * Unlinked tray truth · 2026-10-02.
 *
 * Production showed grounded decisions in the Home "Unlinked" tray: the entry's
 * mission/goal FK was real, but that mission/goal sat outside the top-N window
 * the graph loads, so the FK edge had no second end. The builder now loads the
 * out-of-window anchor. And deleting a goal/mission SET NULLs the FK while
 * link_status kept claiming "auto" — the journal sweep now resets those rows
 * for re-grounding.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const t = () => ({ findMany: vi.fn(), updateMany: vi.fn() });
  return {
    prisma: {
      mission: t(),
      task: t(),
      lifeGoal: t(),
      brainDump: t(),
      reflection: t(),
      situationLog: t(),
      decisionReplay: t(),
      personProfile: t(),
      brainMemory: t(),
      memoryEdge: t(),
      semanticEdge: t(),
    },
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

import { getBrainGraph } from "@/lib/brain/brain-graph";
import { LINK_CLAIMING_STATUSES, backfillJournalBrain, requeueDanglingLinks } from "@/lib/brain/journal-brain";

const NOW = new Date("2026-10-02T12:00:00Z");

beforeEach(() => {
  for (const table of Object.values(h.prisma)) {
    table.findMany.mockReset();
    table.findMany.mockResolvedValue([]);
    table.updateMany.mockReset();
    table.updateMany.mockResolvedValue({ count: 0 });
  }
});

const decision = {
  id: "dec-1",
  title: "Bringing Jason back as a tech",
  choiceMade: "yes",
  outcome: null,
  context: null,
  lesson: null,
  reviewed: false,
  missionId: "mis-old",
  goalId: null,
  createdAt: NOW,
};
const oldMission = {
  id: "mis-old",
  title: "Staff the bays",
  status: "PAUSED",
  priority: 5,
  neglectCost: 0,
  roiScore: 0,
  createdAt: new Date("2026-06-01T00:00:00Z"),
};

describe("getBrainGraph · out-of-window anchors", () => {
  it("loads a grounded decision's mission when the window missed it, so the decision is linked", async () => {
    h.prisma.decisionReplay.findMany.mockResolvedValue([decision]);
    // window query returns nothing; the anchor query (by id) returns the mission
    h.prisma.mission.findMany.mockImplementation(async (args: { where?: { id?: unknown } }) =>
      args?.where?.id ? [oldMission] : [],
    );

    const g = await getBrainGraph({ scope: "home" });

    expect(g.nodes.some((n) => n.id === "mis-old")).toBe(true);
    expect(g.edges.some((e) => e.source === "dec-1" && e.target === "mis-old" && e.origin === "fk")).toBe(true);
    expect(g.unlinked.some((n) => n.id === "dec-1")).toBe(false);
    const anchorCall = h.prisma.mission.findMany.mock.calls.find((c) => (c[0] as { where?: { id?: unknown } })?.where?.id);
    expect(anchorCall?.[0]).toMatchObject({ where: { id: { in: ["mis-old"] }, deletedAt: null } });
  });

  it("a failed anchor read is named in degraded and the decision stays honestly unlinked", async () => {
    h.prisma.decisionReplay.findMany.mockResolvedValue([decision]);
    h.prisma.mission.findMany.mockImplementation(async (args: { where?: { id?: unknown } }) => {
      if (args?.where?.id) throw new Error("pool exhausted");
      return [];
    });

    const g = await getBrainGraph({ scope: "home" });

    expect(g.degraded).toContain("anchor_missions");
    expect(g.unlinked.some((n) => n.id === "dec-1")).toBe(true);
  });

  it("issues no anchor query when every FK target is already loaded", async () => {
    h.prisma.decisionReplay.findMany.mockResolvedValue([decision]);
    h.prisma.mission.findMany.mockResolvedValue([oldMission]);

    await getBrainGraph({ scope: "home" });

    expect(h.prisma.mission.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("requeueDanglingLinks · a deleted goal/mission does not leave a claimed link", () => {
  it("resets only rows whose status claims a link that has no FK, never 'rejected'", async () => {
    h.prisma.decisionReplay.updateMany.mockResolvedValue({ count: 10 });

    expect(await requeueDanglingLinks("decision_replay")).toBe(10);

    const arg = h.prisma.decisionReplay.updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(arg.where).toEqual({ goalId: null, missionId: null, linkStatus: { in: ["auto", "proposed", "confirmed"] } });
    expect(LINK_CLAIMING_STATUSES).not.toContain("rejected");
    expect(arg.data).toEqual({ linkStatus: null, linkConfidence: null, enrichedAt: null });
  });

  it("routes each silo to its own table and answers 0 on a failed write", async () => {
    await requeueDanglingLinks("brain_dump");
    await requeueDanglingLinks("reflection");
    await requeueDanglingLinks("situation_log");
    expect(h.prisma.brainDump.updateMany).toHaveBeenCalledOnce();
    expect(h.prisma.reflection.updateMany).toHaveBeenCalledOnce();
    expect(h.prisma.situationLog.updateMany).toHaveBeenCalledOnce();
    h.prisma.reflection.updateMany.mockRejectedValue(new Error("db down"));
    expect(await requeueDanglingLinks("reflection")).toBe(0);
  });
});

describe("backfillJournalBrain · the cron sweep runs the requeue", () => {
  it("resets dangling links before selecting rows to re-ground, and reports the count", async () => {
    h.prisma.decisionReplay.updateMany.mockResolvedValue({ count: 3 });
    const [r] = await backfillJournalBrain({ silo: "decision_replay", limit: 1 });
    expect(h.prisma.decisionReplay.updateMany).toHaveBeenCalledOnce();
    expect(r).toMatchObject({ silo: "decision_replay", requeued: 3 });
  });

  it("a dry run writes nothing", async () => {
    await backfillJournalBrain({ silo: "decision_replay", dryRun: true });
    expect(h.prisma.decisionReplay.updateMany).not.toHaveBeenCalled();
  });
});
