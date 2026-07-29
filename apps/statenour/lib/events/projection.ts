/**
 * lib/events/projection.ts — the V1 read projection (2026-07-29).
 *
 * One merge-sorted, envelope-shaped view over all eight event models.
 * Read-only by construction: bounded takes per model, no producer is
 * touched, no write path exists here. An envelope that fails schema
 * validation is dropped and COUNTED (surfaced as `dropped`), never
 * silently coerced — unknown shapes stay visible as a number instead
 * of pretending completeness.
 *
 * Privacy: `restricted` envelopes never leave this module; `sensitive`
 * payloads have `data` replaced with a redaction marker unless the
 * caller explicitly opts in (operator-only surfaces may).
 */
import { prisma } from "@/lib/prisma";
import { validateEnvelope, type DomainEventEnvelope } from "./envelope";
import {
  fromTaskEvent,
  fromGoalEvent,
  fromDeviceEvent,
  fromAutonomousEvent,
  fromVisionEvent,
  fromBrainBusEvent,
  fromAuditEvent,
  fromEntityAudit,
} from "./adapters";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("events/projection");

export interface TimelineResult {
  events: DomainEventEnvelope[];
  /** Envelopes that failed validation — visible, never silent. */
  dropped: number;
  /** Per-source row counts actually read (bounded takes — a source at
   *  its cap may have more; this is a window, not a census). */
  sources: Record<string, number>;
  windowDays: number;
}

export async function readOperatorTimeline(options?: {
  windowDays?: number;
  perSourceLimit?: number;
  includeSensitiveData?: boolean;
}): Promise<TimelineResult> {
  const windowDays = options?.windowDays ?? 3;
  const take = options?.perSourceLimit ?? 40;
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const includeSensitive = options?.includeSensitiveData ?? false;

  const [tasks, goals, devices, autonomous, vision, bus, audits, entity] =
    await Promise.all([
      prisma.taskEvent.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take,
        select: { id: true, taskId: true, kind: true, source: true, payload: true, createdAt: true },
      }).catch(() => []),
      prisma.goalEvent.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take,
        select: { id: true, goalId: true, kind: true, source: true, payload: true, createdAt: true },
      }).catch(() => []),
      prisma.deviceEvent.findMany({
        where: { timestamp: { gte: since } },
        orderBy: { timestamp: "desc" },
        take,
        select: { id: true, deviceId: true, event: true, source: true, data: true, timestamp: true },
      }).catch(() => []),
      prisma.autonomousEvent.findMany({
        where: { firedAt: { gte: since } },
        orderBy: { firedAt: "desc" },
        take,
        select: { id: true, eventId: true, ruleName: true, actionType: true, targetType: true, targetId: true, result: true, firedAt: true },
      }).catch(() => []),
      prisma.visionEvent.findMany({
        where: { timestamp: { gte: since } },
        orderBy: { timestamp: "desc" },
        take,
        select: { id: true, event: true, camera: true, source: true, data: true, timestamp: true },
      }).catch(() => []),
      prisma.brainBusEvent.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take,
        select: { id: true, topic: true, eventType: true, payload: true, createdAt: true },
      }).catch(() => []),
      prisma.auditEvent.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take,
        select: { id: true, actor: true, eventType: true, detail: true, payload: true, createdAt: true },
      }).catch(() => []),
      prisma.entityAudit.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take,
        select: { id: true, entityType: true, entityId: true, action: true, actor: true, before: true, createdAt: true },
      }).catch(() => []),
    ]);

  const candidates: DomainEventEnvelope[] = [
    ...tasks.map(fromTaskEvent),
    ...goals.map(fromGoalEvent),
    ...devices.map(fromDeviceEvent),
    ...autonomous.map(fromAutonomousEvent),
    ...vision.map(fromVisionEvent),
    ...bus.map(fromBrainBusEvent),
    ...audits.map(fromAuditEvent),
    ...entity.map(fromEntityAudit),
  ];

  let dropped = 0;
  const events: DomainEventEnvelope[] = [];
  for (const c of candidates) {
    const valid = validateEnvelope(c);
    if (!valid) {
      dropped++;
      continue;
    }
    if (valid.privacyClass === "restricted") continue;
    events.push(
      valid.privacyClass === "sensitive" && !includeSensitive
        ? { ...valid, data: { redacted: true, reason: "sensitive — opt in to view" } }
        : valid,
    );
  }
  if (dropped > 0) log.warn("envelopes_dropped", { dropped });

  events.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));

  return {
    events,
    dropped,
    sources: {
      "task-event": tasks.length,
      "goal-event": goals.length,
      "device-event": devices.length,
      "autonomous-event": autonomous.length,
      "vision-event": vision.length,
      "brain-bus-event": bus.length,
      "audit-event": audits.length,
      "entity-audit": entity.length,
    },
    windowDays,
  };
}
