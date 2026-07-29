/**
 * tests/events/envelope-adapters.test.ts — Event Envelope V1
 * (2026-07-29): every adapter yields a schema-valid envelope; identity
 * is replay-stable; the traceparent mapping is deterministic and
 * never replaces the native correlation id.
 */

import { describe, it, expect } from "vitest";
import {
  domainEventEnvelopeSchema,
  toTraceparent,
  EVENT_ACTOR_TYPES,
  EVENT_PRIVACY_CLASSES,
  eventTypeName,
} from "@/lib/events/envelope";
// Canonical contract, imported RELATIVELY (the junctioned @nour/utils
// can't see same-PR additions) — pins the app-side runtime mirrors.
import {
  EVENT_ACTOR_TYPES as CANON_ACTORS,
  EVENT_PRIVACY_CLASSES as CANON_PRIVACY,
  eventTypeName as canonEventTypeName,
} from "../../../../packages/utils/src/contracts";
import {
  fromTaskEvent,
  fromGoalEvent,
  fromDeviceEvent,
  fromAutonomousEvent,
  fromVisionEvent,
  fromBrainBusEvent,
  fromAuditEvent,
  fromEntityAudit,
  withTrace,
} from "@/lib/events/adapters";

const at = new Date("2026-07-29T12:00:00Z");

const fixtures = [
  {
    name: "TaskEvent",
    make: () =>
      fromTaskEvent({ id: "te1", taskId: "t1", kind: "completed", source: "triage:done", payload: { a: 1 }, createdAt: at }),
    expectType: "com.statenour.task.task.completed.v1",
  },
  {
    name: "GoalEvent",
    make: () =>
      fromGoalEvent({ id: "ge1", goalId: "g1", kind: "progressed", source: null, payload: null, createdAt: at }),
    expectType: "com.statenour.goal.goal.progressed.v1",
  },
  {
    name: "DeviceEvent",
    make: () =>
      fromDeviceEvent({ id: "de1", deviceId: "d1", event: "motion_detected", source: "local", data: {}, timestamp: at }),
    expectType: "com.statenour.device.device.motion_detected.v1",
  },
  {
    name: "AutonomousEvent",
    make: () =>
      fromAutonomousEvent({ id: "ae1", eventId: "e1", ruleName: "memory_promotion", actionType: "promote", targetType: "BrainMemory", targetId: "m1", result: "executed", firedAt: at }),
    expectType: "com.statenour.autonomy.brainmemory.executed.v1",
  },
  {
    name: "VisionEvent",
    make: () =>
      fromVisionEvent({ id: "ve1", event: "vision.motion_detected", camera: "SHOPINSIDE", source: "v380", data: { score: 0.9 }, timestamp: at }),
    expectType: "com.statenour.vision.camera.motion_detected.v1",
  },
  {
    name: "BrainBusEvent",
    make: () =>
      fromBrainBusEvent({ id: "be1", topic: "tasks", eventType: "task.completed", payload: { taskId: "t1" }, createdAt: at }),
    expectType: "com.statenour.brain.tasks.completed.v1",
  },
  {
    name: "AuditEvent",
    make: () =>
      fromAuditEvent({ id: "au1", actor: "operator", eventType: "feature_flag_override", detail: "X: a → b", payload: null, createdAt: at }),
    expectType: "com.statenour.audit.system.feature_flag_override.v1",
  },
  {
    name: "EntityAudit",
    make: () =>
      fromEntityAudit({ id: "ea1", entityType: "Task", entityId: "t1", action: "update", actor: "owner", before: { x: 1 }, createdAt: at }),
    expectType: "com.statenour.audit.task.update.v1",
  },
] as const;

describe("runtime mirrors are drift-pinned to the canonical contract", () => {
  it("actor types, privacy classes, and type-name builder match @nour/utils/contracts exactly", () => {
    expect([...EVENT_ACTOR_TYPES]).toEqual([...CANON_ACTORS]);
    expect([...EVENT_PRIVACY_CLASSES]).toEqual([...CANON_PRIVACY]);
    expect(eventTypeName("Task", "My.Entity", "Was Done", 2)).toBe(
      canonEventTypeName("Task", "My.Entity", "Was Done", 2),
    );
  });
});

describe("adapters → schema-valid envelopes", () => {
  for (const f of fixtures) {
    it(`${f.name} maps to a valid envelope with the expected type name`, () => {
      const env = f.make();
      const parsed = domainEventEnvelopeSchema.safeParse(env);
      expect(parsed.success, JSON.stringify(parsed.success ? "" : parsed.error.issues)).toBe(true);
      expect(env.type).toBe(f.expectType);
    });
  }

  it("identity is replay-stable: same row → same envelope id + type", () => {
    const a = fixtures[0].make();
    const b = fixtures[0].make();
    expect(a.id).toBe(b.id);
    expect(a.type).toBe(b.type);
    expect(a.time).toBe(b.time);
  });

  it("operator-sourced triage TaskEvents carry actorType operator", () => {
    expect(fixtures[0].make().actorType).toBe("operator");
  });

  it("camera/device/bus envelopes are sensitive by default — never public", () => {
    expect(fromVisionEvent({ id: "v", event: "x", camera: null, source: "s", data: null, timestamp: at }).privacyClass).toBe("sensitive");
    expect(fromDeviceEvent({ id: "d", deviceId: "d", event: "x", source: "s", data: null, timestamp: at }).privacyClass).toBe("sensitive");
    expect(fromBrainBusEvent({ id: "b", topic: "t", eventType: "x", payload: {}, createdAt: at }).privacyClass).toBe("sensitive");
  });
});

describe("trace mapping", () => {
  it("deterministic: same traceId+eventId → same traceparent; W3C-shaped", () => {
    const t1 = toTraceparent("trace-abc", "ev1");
    expect(t1).toBe(toTraceparent("trace-abc", "ev1"));
    expect(t1).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/);
  });

  it("same trace across different events shares the 32-hex trace-id segment", () => {
    const a = toTraceparent("trace-abc", "ev1")!;
    const b = toTraceparent("trace-abc", "ev2")!;
    expect(a.slice(3, 35)).toBe(b.slice(3, 35));
    expect(a.slice(36, 52)).not.toBe(b.slice(36, 52));
  });

  it("withTrace keeps the native correlationId verbatim beside the derived line", () => {
    const env = withTrace(fixtures[0].make(), "trace-xyz");
    expect(env.correlationId).toBe("trace-xyz");
    expect(env.traceparent).toMatch(/^00-/);
    const parsed = domainEventEnvelopeSchema.safeParse(env);
    expect(parsed.success).toBe(true);
  });

  it("empty traceId maps to no traceparent, not a garbage line", () => {
    expect(toTraceparent("", "ev1")).toBeUndefined();
    expect(withTrace(fixtures[1].make(), null).traceparent).toBeUndefined();
  });
});
