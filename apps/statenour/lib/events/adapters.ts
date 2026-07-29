/**
 * lib/events/adapters.ts — Event Envelope V1 adapters (2026-07-29).
 *
 * One pure adapter per event model, row → envelope. Rules:
 *   · `id` is the source row's own id — replaying the same row yields
 *     the same envelope identity (dedup-stable).
 *   · `time` is the event's OWN timestamp (DeviceEvent/VisionEvent
 *     carry a `timestamp` distinct from createdAt — that one wins).
 *   · privacyClass is assigned per MODEL (conservative): camera/vision
 *     and device state are `sensitive`; brain-bus payloads carry
 *     operator-personal content → `sensitive`; task/goal/audit
 *     metadata are `internal`. Nothing here is `public`.
 *   · Payloads pass through as `data` — the projection layer decides
 *     what to render; `restricted` never leaves the server.
 */
import {
  eventTypeName,
  toTraceparent,
  type DomainEventEnvelope,
} from "./envelope";

const iso = (d: Date | string | null | undefined): string =>
  (d instanceof Date ? d : d ? new Date(d) : new Date(0)).toISOString();

const base = (
  id: string,
  source: string,
  type: string,
  time: Date | string | null | undefined,
  data: unknown,
  extra: Partial<DomainEventEnvelope>,
): DomainEventEnvelope => ({
  specversion: "1.0",
  id,
  source,
  type,
  time: iso(time),
  datacontenttype: "application/json",
  data,
  schemaVersion: 1,
  actorType: "system",
  privacyClass: "internal",
  ...extra,
});

const seg = (s: string | null | undefined, fallback: string) =>
  (s ?? fallback).toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || fallback;

export interface TaskEventRow {
  id: string;
  taskId: string;
  kind: string;
  source: string | null;
  payload: unknown;
  createdAt: Date;
}
export const fromTaskEvent = (r: TaskEventRow): DomainEventEnvelope =>
  base(r.id, "statenour/task-event", eventTypeName("task", "task", r.kind), r.createdAt, r.payload ?? {}, {
    subject: r.taskId,
    actorType: r.source?.startsWith("triage:") ? "operator" : "system",
    actorId: r.source ?? undefined,
  });

export interface GoalEventRow {
  id: string;
  goalId: string;
  kind: string;
  source: string | null;
  payload: unknown;
  createdAt: Date;
}
export const fromGoalEvent = (r: GoalEventRow): DomainEventEnvelope =>
  base(r.id, "statenour/goal-event", eventTypeName("goal", "goal", r.kind), r.createdAt, r.payload ?? {}, {
    subject: r.goalId,
    actorId: r.source ?? undefined,
  });

export interface DeviceEventRow {
  id: string;
  deviceId: string;
  event: string;
  source: string;
  data: unknown;
  timestamp: Date;
}
export const fromDeviceEvent = (r: DeviceEventRow): DomainEventEnvelope =>
  base(r.id, "statenour/device-event", eventTypeName("device", "device", r.event), r.timestamp, r.data ?? {}, {
    subject: r.deviceId,
    actorType: "integration",
    actorId: r.source,
    privacyClass: "sensitive",
  });

export interface AutonomousEventRow {
  id: string;
  eventId: string;
  ruleName: string;
  actionType: string | null;
  targetType: string | null;
  targetId: string | null;
  result: string;
  /** AutonomousEvent's own clock is firedAt (no createdAt column). */
  firedAt: Date;
}
export const fromAutonomousEvent = (r: AutonomousEventRow): DomainEventEnvelope =>
  base(
    r.id,
    "statenour/autonomous-event",
    eventTypeName("autonomy", seg(r.targetType, "action"), r.result),
    r.firedAt,
    { ruleName: r.ruleName, actionType: r.actionType, targetId: r.targetId },
    { subject: r.targetId ?? r.eventId, actorType: "agent", actorId: r.ruleName },
  );

export interface VisionEventRow {
  id: string;
  event: string;
  camera: string | null;
  source: string;
  data: unknown;
  timestamp: Date;
}
export const fromVisionEvent = (r: VisionEventRow): DomainEventEnvelope =>
  base(
    r.id,
    "statenour/vision-event",
    // event strings arrive dot-namespaced ("vision.motion_detected") —
    // the verb segment keeps only the tail so the type stays parseable.
    eventTypeName("vision", "camera", r.event.split(".").pop() ?? r.event),
    r.timestamp,
    r.data ?? {},
    { subject: r.camera ?? undefined, actorType: "integration", actorId: r.source, privacyClass: "sensitive" },
  );

export interface BrainBusEventRow {
  id: string;
  topic: string;
  eventType: string;
  payload: unknown;
  createdAt: Date;
}
export const fromBrainBusEvent = (r: BrainBusEventRow): DomainEventEnvelope =>
  base(
    r.id,
    "statenour/brain-bus-event",
    eventTypeName("brain", seg(r.topic, "bus"), r.eventType.split(".").pop() ?? r.eventType),
    r.createdAt,
    r.payload,
    { subject: r.topic, privacyClass: "sensitive" },
  );

export interface AuditEventRow {
  id: string;
  actor: string;
  eventType: string;
  detail: string;
  payload: unknown;
  createdAt: Date;
}
export const fromAuditEvent = (r: AuditEventRow): DomainEventEnvelope =>
  base(r.id, "statenour/audit-event", eventTypeName("audit", "system", r.eventType), r.createdAt, { detail: r.detail, payload: r.payload ?? null }, {
    actorType: r.actor === "operator" ? "operator" : "system",
    actorId: r.actor,
  });

export interface EntityAuditRow {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  before: unknown;
  createdAt: Date;
}
export const fromEntityAudit = (r: EntityAuditRow): DomainEventEnvelope =>
  base(
    r.id,
    "statenour/entity-audit",
    eventTypeName("audit", seg(r.entityType, "entity"), r.action),
    r.createdAt,
    { before: r.before ?? null },
    {
      subject: r.entityId,
      actorType: r.actor === "operator" || r.actor === "owner" ? "operator" : "system",
      actorId: r.actor,
    },
  );

/** Attach the derived W3C traceparent when a native correlation id is
 *  known. Kept separate so adapters stay trivially pure. */
export function withTrace(
  env: DomainEventEnvelope,
  traceId: string | null | undefined,
): DomainEventEnvelope {
  if (!traceId) return env;
  return {
    ...env,
    correlationId: traceId,
    traceparent: toTraceparent(traceId, env.id),
  };
}
