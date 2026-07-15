/**
 * Nick Action Queue (Wave AG · 2026-05-28) · proposer + executor tests.
 *
 * Locks in:
 *   - Proposer picks the right candidates from operator state.
 *   - Empty queue returns [], never throws.
 *   - Ranking sorts P0 → P2 deterministically.
 *   - Executor dispatches by actionType + writes the expected side-
 *     effect to the mocked DB.
 *   - Stale/already-closed targets return idempotent {ok:true, meta.idempotent:true}.
 *   - Unknown actionType returns a safe failure (no throw).
 *
 * No real Prisma · no real Telegram · all I/O mocked.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mission: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    brainDump: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    brainMemory: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    personProfile: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/brain/journal-ingest", () => ({
  ingestJournal: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { proposeNickActions } from "@/lib/ai/propose-actions";
import { executeNickAction } from "@/lib/ai/execute-actions";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Proposer ─────────────────────────────────────────────────────

describe("proposeNickActions · sources", () => {
  it("returns [] when every source is empty", async () => {
    vi.mocked(prisma.mission.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.brainDump.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.brainMemory.findFirst).mockResolvedValue(null);

    const drafts = await proposeNickActions("2026-05-28");
    expect(drafts).toEqual([]);
  });

  it("picks an archive_mission candidate when every task is DONE", async () => {
    vi.mocked(prisma.mission.findMany).mockResolvedValue([
      {
        id: "m-1",
        title: "Wrap launch",
        tasks: [
          { id: "t-1", status: "DONE" },
          { id: "t-2", status: "DONE" },
        ],
      },
    ] as never);
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.brainDump.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.brainMemory.findFirst).mockResolvedValue(null);

    const drafts = await proposeNickActions("2026-05-28");
    expect(drafts).toHaveLength(1);
    expect(drafts[0].actionType).toBe("archive_mission");
    expect(drafts[0].targetId).toBe("m-1");
    expect(drafts[0].priority).toBe("P2");
  });

  it("skips an archive_mission with at least one open task", async () => {
    vi.mocked(prisma.mission.findMany).mockResolvedValue([
      {
        id: "m-2",
        title: "Mixed",
        tasks: [
          { id: "t-1", status: "DONE" },
          { id: "t-2", status: "DOING" }, // not closed
        ],
      },
    ] as never);
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.brainDump.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.brainMemory.findFirst).mockResolvedValue(null);

    const drafts = await proposeNickActions("2026-05-28");
    expect(drafts.filter((d) => d.actionType === "archive_mission")).toEqual([]);
  });

  it("emits nudge_task as P0 when task is > 7d overdue", async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000);
    vi.mocked(prisma.mission.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.task.findMany).mockImplementation(async (args) => {
      // Distinguish nudge query (status DOING) vs reassign query (status INBOX)
      const where = (args as { where?: { status?: string } } | undefined)?.where;
      if (where?.status === "DOING") {
        return [
          {
            id: "t-old",
            title: "Refactor RoutingBlock",
            dueDate: eightDaysAgo,
            mission: { id: "m-1", title: "Tech debt" },
          },
        ] as never;
      }
      return [] as never;
    });
    vi.mocked(prisma.brainDump.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.brainMemory.findFirst).mockResolvedValue(null);

    const drafts = await proposeNickActions("2026-05-28");
    const nudge = drafts.find((d) => d.actionType === "nudge_task");
    expect(nudge).toBeDefined();
    expect(nudge!.priority).toBe("P0");
    expect(nudge!.payload.daysOverdue).toBeGreaterThanOrEqual(8);
  });

  it("emits send_sms_outreach when today's relationship pick exists", async () => {
    vi.mocked(prisma.mission.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.brainDump.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.brainMemory.findFirst).mockResolvedValue({
      metadata: {
        picks: [
          {
            personId: "p-karim",
            personName: "Karim",
            rationale: "12d silent · law 18",
          },
        ],
      },
    } as never);

    const drafts = await proposeNickActions("2026-05-28");
    const outreach = drafts.find((d) => d.actionType === "send_sms_outreach");
    expect(outreach).toBeDefined();
    expect(outreach!.targetId).toBe("p-karim");
    expect(outreach!.priority).toBe("P1");
  });

  it("ranks P0 candidates before P1 and P2", async () => {
    // P0 = nudge_task (12d overdue), P1 = outreach, P2 = archive
    const twelveDaysAgo = new Date(Date.now() - 12 * 86_400_000);
    vi.mocked(prisma.mission.findMany).mockResolvedValue([
      {
        id: "m-1",
        title: "Wrap launch",
        tasks: [{ id: "t-1", status: "DONE" }],
      },
    ] as never);
    vi.mocked(prisma.task.findMany).mockImplementation(async (args) => {
      const where = (args as { where?: { status?: string } } | undefined)?.where;
      if (where?.status === "DOING") {
        return [
          {
            id: "t-old",
            title: "Refactor",
            dueDate: twelveDaysAgo,
            mission: { id: "m-1", title: "Tech debt" },
          },
        ] as never;
      }
      return [] as never;
    });
    vi.mocked(prisma.brainDump.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.brainMemory.findFirst).mockResolvedValue({
      metadata: {
        picks: [
          {
            personId: "p-karim",
            personName: "Karim",
            rationale: "12d silent",
          },
        ],
      },
    } as never);

    const drafts = await proposeNickActions("2026-05-28");
    expect(drafts.map((d) => d.priority)).toEqual(["P0", "P1", "P2"]);
  });
});

// ── Executor ─────────────────────────────────────────────────────

describe("executeNickAction · dispatch", () => {
  it("archive_mission flips ACTIVE → COMPLETE", async () => {
    vi.mocked(prisma.mission.findUnique).mockResolvedValue({
      id: "m-1",
      title: "Wrap",
      status: "ACTIVE",
      deletedAt: null,
    } as never);
    vi.mocked(prisma.mission.update).mockResolvedValue({} as never);

    const r = await executeNickAction({
      actionRowId: "row-1",
      actionType: "archive_mission",
      targetId: "m-1",
      payload: {},
    });
    expect(r.ok).toBe(true);
    expect(vi.mocked(prisma.mission.update)).toHaveBeenCalledWith({
      where: { id: "m-1" },
      data: { status: "COMPLETE", updatedBy: "nick" },
    });
  });

  it("archive_mission returns idempotent when already COMPLETE", async () => {
    vi.mocked(prisma.mission.findUnique).mockResolvedValue({
      id: "m-1",
      title: "Wrap",
      status: "COMPLETE",
      deletedAt: null,
    } as never);

    const r = await executeNickAction({
      actionRowId: "row-1",
      actionType: "archive_mission",
      targetId: "m-1",
      payload: {},
    });
    expect(r.ok).toBe(true);
    expect(r.meta?.idempotent).toBe(true);
    expect(vi.mocked(prisma.mission.update)).not.toHaveBeenCalled();
  });

  it("archive_mission returns mission_not_found when row gone", async () => {
    vi.mocked(prisma.mission.findUnique).mockResolvedValue(null);

    const r = await executeNickAction({
      actionRowId: "row-x",
      actionType: "archive_mission",
      targetId: "m-gone",
      payload: {},
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("mission_not_found");
  });

  it("nudge_task flips DOING → READY + writes a brain memory hint", async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      id: "t-1",
      title: "Refactor",
      status: "DOING",
      deletedAt: null,
    } as never);
    vi.mocked(prisma.task.update).mockResolvedValue({} as never);
    vi.mocked(prisma.brainMemory.create).mockResolvedValue({} as never);

    const r = await executeNickAction({
      actionRowId: "row-2",
      actionType: "nudge_task",
      targetId: "t-1",
      payload: {},
    });
    expect(r.ok).toBe(true);
    expect(vi.mocked(prisma.task.update)).toHaveBeenCalledWith({
      where: { id: "t-1" },
      data: { status: "READY", updatedBy: "nick" },
    });
    expect(vi.mocked(prisma.brainMemory.create)).toHaveBeenCalled();
  });

  it("nudge_task no-ops when target is no longer DOING", async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      id: "t-1",
      title: "Refactor",
      status: "DONE", // already closed
      deletedAt: null,
    } as never);

    const r = await executeNickAction({
      actionRowId: "row-2",
      actionType: "nudge_task",
      targetId: "t-1",
      payload: {},
    });
    expect(r.ok).toBe(true);
    expect(r.meta?.idempotent).toBe(true);
    expect(vi.mocked(prisma.task.update)).not.toHaveBeenCalled();
  });

  it("reassign_task snoozes INBOX 7 days into WAITING", async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      id: "t-1",
      title: "Old inbox row",
      status: "INBOX",
      deletedAt: null,
    } as never);
    vi.mocked(prisma.task.update).mockResolvedValue({} as never);

    const r = await executeNickAction({
      actionRowId: "row-3",
      actionType: "reassign_task",
      targetId: "t-1",
      payload: {},
    });
    expect(r.ok).toBe(true);
    const call = vi.mocked(prisma.task.update).mock.calls[0]?.[0];
    expect((call as { data: { status: string } }).data.status).toBe("WAITING");
    expect((call as { data: { snoozedUntil: Date } }).data.snoozedUntil).toBeInstanceOf(Date);
  });

  it("send_sms_outreach drafts to BrainMemory but does not send", async () => {
    vi.mocked(prisma.personProfile.findUnique).mockResolvedValue({
      id: "p-1",
      name: "Karim Bakr",
      role: "close_friend",
      status: "active",
      deletedAt: null,
    } as never);
    vi.mocked(prisma.brainMemory.create).mockResolvedValue({} as never);

    const r = await executeNickAction({
      actionRowId: "row-4",
      actionType: "send_sms_outreach",
      targetId: "p-1",
      payload: { rationale: "12d silent · law 18" },
    });
    expect(r.ok).toBe(true);
    expect(vi.mocked(prisma.brainMemory.create)).toHaveBeenCalled();
    const draft = r.meta?.draftBody as string;
    expect(draft).toContain("Karim"); // first name lifted
    expect(draft).toContain("12d silent"); // rationale embedded
  });

  it("commit_journal calls ingestJournal on the dump's raw text", async () => {
    vi.mocked(prisma.brainDump.findUnique).mockResolvedValue({
      id: "d-1",
      rawThoughts: "today was rough",
      summary: null,
    } as never);
    const ingestModule = await import("@/lib/brain/journal-ingest");
    vi.mocked(ingestModule.ingestJournal).mockResolvedValue({
      tasksCreated: 2,
      insightsStored: 1,
      commitmentsFound: 0,
    } as never);

    const r = await executeNickAction({
      actionRowId: "row-5",
      actionType: "commit_journal",
      targetId: "d-1",
      payload: {},
    });
    expect(r.ok).toBe(true);
    // Audit 2026-07-15 · commit_journal must re-process the EXISTING
    // row (reuseDumpId) — the old single-arg call re-ingested the text
    // as a brand-new brain_dump, duplicating the entry on every run —
    // and must tag source "chat" so no Telegram confirm ping fires.
    expect(vi.mocked(ingestModule.ingestJournal)).toHaveBeenCalledWith(
      "today was rough",
      "chat",
      { reuseDumpId: "d-1" },
    );
    expect(r.meta?.tasksCreated).toBe(2);
  });

  it("commit_journal returns idempotent when dump already has a summary", async () => {
    vi.mocked(prisma.brainDump.findUnique).mockResolvedValue({
      id: "d-1",
      rawThoughts: "today was rough",
      summary: "Previously committed",
    } as never);

    const r = await executeNickAction({
      actionRowId: "row-5",
      actionType: "commit_journal",
      targetId: "d-1",
      payload: {},
    });
    expect(r.ok).toBe(true);
    expect(r.meta?.idempotent).toBe(true);
  });

  it("never throws on unknown actionType", async () => {
    const r = await executeNickAction({
      actionRowId: "row-x",
      actionType: "this-does-not-exist" as never,
      targetId: "x",
      payload: {},
    });
    expect(r.ok).toBe(false);
  });
});
