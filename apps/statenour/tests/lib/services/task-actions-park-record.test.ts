/**
 * tests/lib/services/task-actions-park-record.test.ts · 2026-09-07 (program U5)
 *
 * parkTask writes the structured resume record onto the SAME `parked`
 * TaskEvent the deck already replays — normalized, with `parkedAt`, and
 * `record: null` when the operator gave nothing (legacy readers see only
 * `note`). Mocks mirror task-actions-cascade.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  task: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  mission: { findUnique: vi.fn(), findMany: vi.fn() },
  brainMemory: { findMany: vi.fn(), upsert: vi.fn() },
  emitTaskEventAsync: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: mocks.task,
    mission: mocks.mission,
    brainMemory: mocks.brainMemory,
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ task: mocks.task, mission: mocks.mission, brainMemory: mocks.brainMemory })),
  },
}));
vi.mock("@/lib/db/entity-audit", () => ({ logCreate: vi.fn(), logUpdate: vi.fn(), stripNoise: vi.fn((x: unknown) => x) }));
vi.mock("@/lib/cache/dashboard-cache", () => ({ invalidateMutationCaches: vi.fn() }));
vi.mock("@/lib/brain/task-events", () => ({ emitTaskEventAsync: mocks.emitTaskEventAsync, emitTaskCompleted: vi.fn() }));
vi.mock("@/lib/services/auto-learn", () => ({ runAutoLearn: vi.fn(async () => null) }));
vi.mock("@/lib/services/skill-reinforce", () => ({ reinforceSkill: vi.fn(async () => undefined), matchSkillKeys: vi.fn(() => []) }));
vi.mock("@/lib/runtime", () => ({ isDemoMode: false }));
vi.mock("@/lib/services/outcome-ledger", () => ({ recordOutcomeByContent: vi.fn(async () => true) }));

import { parkTask } from "@/lib/services/task-actions";

const doing = { id: "t1", status: "DOING", startedAt: new Date("2026-09-07T10:00:00Z"), lastTouchedAt: new Date("2026-09-07T10:00:00Z") };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.task.findUnique.mockResolvedValue(doing);
  mocks.task.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...doing, ...data }));
});

describe("parkTask · resume record", () => {
  it("writes note + normalized record + parkedAt on the parked event", async () => {
    const before = Date.now();
    await parkTask("t1", "  drywall cut, tape next  ", {
      intendedOutcome: " wall ready to paint ",
      evidenceLinks: ["/journal", "javascript:alert(1)"],
      nextPhysicalAction: "sand the seam",
    });
    expect(mocks.emitTaskEventAsync).toHaveBeenCalledTimes(1);
    const evt = mocks.emitTaskEventAsync.mock.calls[0][0];
    expect(evt).toMatchObject({ taskId: "t1", kind: "parked" });
    expect(evt.payload.note).toBe("drywall cut, tape next");
    expect(evt.payload.record).toEqual({
      intendedOutcome: "wall ready to paint",
      lastVerifiedStep: null,
      evidenceLinks: ["/journal"],
      openQuestion: null,
      nextPhysicalAction: "sand the seam",
    });
    expect(Date.parse(evt.payload.parkedAt)).toBeGreaterThanOrEqual(before - 1000);
  });

  it("no record given → record: null (legacy shape preserved), status flips to READY", async () => {
    const out = await parkTask("t1", "quick stop");
    expect(out.ok).toBe(true);
    expect(mocks.task.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "READY", startedAt: null }) }));
    expect(mocks.emitTaskEventAsync.mock.calls[0][0].payload.record).toBeNull();
  });

  it("an all-blank record is null too — no empty object on the event", async () => {
    await parkTask("t1", "n", { intendedOutcome: "   ", evidenceLinks: [] });
    expect(mocks.emitTaskEventAsync.mock.calls[0][0].payload.record).toBeNull();
  });

  it("positive control: only a DOING task can be parked", async () => {
    mocks.task.findUnique.mockResolvedValue({ ...doing, status: "READY" });
    await expect(parkTask("t1", "n")).rejects.toMatchObject({ status: 400 });
    expect(mocks.emitTaskEventAsync).not.toHaveBeenCalled();
  });
});
