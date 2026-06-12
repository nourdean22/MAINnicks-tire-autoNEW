/**
 * Brain-bus emit wrappers · contract tests · v10.0.63.
 *
 * Locks the producer-side promise:
 *   · Each emit wrapper computes a deterministic dedupeKey
 *   · Each wrapper publishes to the right topic + eventType
 *   · Failures in publishDurable are caught — never propagate up
 *     to block the primary write at the call site
 *
 * Without these tests, a future refactor that forgets the
 * try/catch wrap could let a transient brain-bus DB issue silently
 * fail every drift / commitment / task / score / autonomous write
 * across the app.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma + the durable publisher so the emit functions don't
// touch a real DB. We inspect the publish call shape through the mock.
// vi.mock is hoisted by Vitest, so the mock function must be created
// inside vi.hoisted() to be available at hoist time.
const { publishMock } = vi.hoisted(() => ({
  publishMock: vi.fn(async (_topic: string, _eventType: string, _payload: unknown, _opts: { dedupeKey?: string }) => ({
    id: "evt-mock-id",
    deduped: false,
  })),
}));

vi.mock("@/lib/db/brain-bus-durable", () => ({
  publishDurable: publishMock,
}));

import {
  emitDriftFired,
  emitCommitmentTransition,
  emitTaskCompleted,
  emitScoreLogged,
  emitAutonomousFired,
} from "@/lib/db/brain-bus-emit";

describe("emitDriftFired", () => {
  beforeEach(() => publishMock.mockClear());

  it("publishes to topic=drift.fired with stable dedupeKey", async () => {
    await emitDriftFired({
      alertId: "coach:drift-recovery:stale_task",
      ruleId: "stale_task",
      ruleName: "Stale Task Detection",
      severity: "medium",
      message: "Task X stale",
      date: "2026-05-01",
    });
    expect(publishMock).toHaveBeenCalledTimes(1);
    const [topic, eventType, payload, opts] = publishMock.mock.calls[0];
    expect(topic).toBe("drift.fired");
    expect(eventType).toBe("drift.alert_created");
    expect((payload as { alertId: string }).alertId).toBe("coach:drift-recovery:stale_task");
    expect(opts.dedupeKey).toBe("drift_stale_task_2026-05-01");
  });

  it("dedupeKey is stable for same rule+date (idempotent across calls)", async () => {
    await emitDriftFired({
      alertId: "coach:drift-recovery:x",
      ruleId: "x",
      ruleName: "X",
      severity: "low",
      message: "a",
      date: "2026-05-01",
    });
    await emitDriftFired({
      alertId: "coach:drift-recovery:y",
      ruleId: "x",
      ruleName: "X",
      severity: "low",
      message: "b",
      date: "2026-05-01",
    });
    const k1 = publishMock.mock.calls[0][3].dedupeKey;
    const k2 = publishMock.mock.calls[1][3].dedupeKey;
    expect(k1).toBe(k2);
  });

  it("returns null on publishDurable failure (does not throw)", async () => {
    publishMock.mockRejectedValueOnce(new Error("db down"));
    const result = await emitDriftFired({
      alertId: "coach:drift-recovery:x",
      ruleId: "x",
      ruleName: "X",
      severity: "low",
      message: "m",
      date: "2026-05-01",
    });
    expect(result).toBeNull();
  });
});

describe("emitCommitmentTransition", () => {
  beforeEach(() => publishMock.mockClear());

  it("publishes to topic=commitment.transition with minute-bucket dedupe", async () => {
    const ts = "2026-05-01T12:34:56.000Z";
    await emitCommitmentTransition({
      commitmentId: 7,
      oldStatus: "active",
      newStatus: "completed",
      description: "Email Dania",
      toWhom: "Dania",
      domain: "personal",
      transitionedAt: ts,
    });
    expect(publishMock).toHaveBeenCalledTimes(1);
    const [topic, , , opts] = publishMock.mock.calls[0];
    expect(topic).toBe("commitment.transition");
    // dedupeKey contains the minute bucket — key is "commit_<id>_<status>_<bucket>"
    expect(opts.dedupeKey).toMatch(/^commit_7_completed_\d+$/);
  });

  it("two calls in same minute → same dedupeKey; two minutes apart → different", async () => {
    await emitCommitmentTransition({
      commitmentId: 1,
      oldStatus: "active",
      newStatus: "broken",
      description: "X",
      toWhom: null,
      domain: null,
      transitionedAt: "2026-05-01T12:34:10.000Z",
    });
    await emitCommitmentTransition({
      commitmentId: 1,
      oldStatus: "active",
      newStatus: "broken",
      description: "X",
      toWhom: null,
      domain: null,
      transitionedAt: "2026-05-01T12:34:55.000Z",
    });
    await emitCommitmentTransition({
      commitmentId: 1,
      oldStatus: "active",
      newStatus: "broken",
      description: "X",
      toWhom: null,
      domain: null,
      transitionedAt: "2026-05-01T12:36:01.000Z",
    });
    const k1 = publishMock.mock.calls[0][3].dedupeKey;
    const k2 = publishMock.mock.calls[1][3].dedupeKey;
    const k3 = publishMock.mock.calls[2][3].dedupeKey;
    expect(k1).toBe(k2); // same minute
    expect(k1).not.toBe(k3); // different minute
  });
});

describe("emitTaskCompleted", () => {
  beforeEach(() => publishMock.mockClear());

  it("dedupeKey = task_done_<id>_<yyyymmdd>", async () => {
    await emitTaskCompleted({
      taskId: "task-abc",
      title: "Test task",
      missionId: "m1",
      domain: "personal",
      loopKind: "ONCE",
      completedAt: "2026-05-01T10:30:00.000Z",
    });
    const opts = publishMock.mock.calls[0][3];
    expect(opts.dedupeKey).toBe("task_done_task-abc_2026-05-01");
  });

  it("same-day re-mark = same dedupeKey", async () => {
    await emitTaskCompleted({
      taskId: "t1",
      title: "T",
      missionId: null,
      domain: null,
      loopKind: "DAILY",
      completedAt: "2026-05-01T08:00:00.000Z",
    });
    await emitTaskCompleted({
      taskId: "t1",
      title: "T",
      missionId: null,
      domain: null,
      loopKind: "DAILY",
      completedAt: "2026-05-01T20:00:00.000Z",
    });
    expect(publishMock.mock.calls[0][3].dedupeKey).toBe(publishMock.mock.calls[1][3].dedupeKey);
  });
});

describe("emitScoreLogged", () => {
  beforeEach(() => publishMock.mockClear());

  it("dedupeKey = score_<date>_<source>", async () => {
    await emitScoreLogged({
      date: "2026-05-01",
      snapshot: { score: 7 },
      source: "identity-snapshot:compute",
    });
    const opts = publishMock.mock.calls[0][3];
    expect(opts.dedupeKey).toBe("score_2026-05-01_identity-snapshot:compute");
  });

  it("different sources → different dedupeKey (cron + manual both surface)", async () => {
    await emitScoreLogged({ date: "2026-05-01", snapshot: {}, source: "cron:refresh-identity" });
    await emitScoreLogged({ date: "2026-05-01", snapshot: {}, source: "manual:mastery-engagement" });
    const k1 = publishMock.mock.calls[0][3].dedupeKey;
    const k2 = publishMock.mock.calls[1][3].dedupeKey;
    expect(k1).not.toBe(k2);
  });
});

describe("emitAutonomousFired", () => {
  beforeEach(() => publishMock.mockClear());

  it("uses the engine's idempotencyKey directly as dedupeKey", async () => {
    await emitAutonomousFired({
      ruleName: "drift_escalation",
      actionType: "send_telegram",
      targetType: "drift",
      targetId: null,
      result: "success",
      idempotencyKey: "rule-drift-1234567",
    });
    const opts = publishMock.mock.calls[0][3];
    expect(opts.dedupeKey).toBe("rule-drift-1234567");
  });

  it("topic and eventType encode the rule-level shape", async () => {
    await emitAutonomousFired({
      ruleName: "x",
      actionType: "x",
      targetType: "x",
      targetId: "1",
      result: "failed",
      error: "boom",
      idempotencyKey: "k",
    });
    const [topic, eventType] = publishMock.mock.calls[0];
    expect(topic).toBe("autonomous.fired");
    expect(eventType).toBe("autonomous.rule_executed");
  });
});
