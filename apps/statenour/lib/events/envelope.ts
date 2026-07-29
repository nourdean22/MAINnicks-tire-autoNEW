/**
 * lib/events/envelope.ts — Event Envelope V1 (2026-07-29 · WP-7
 * executor, dossier WP-B).
 *
 * App-side validation + trace mapping for the CloudEvents-shaped
 * envelope whose TYPE lives in @nour/utils/contracts. Boundary rule:
 * adapters validate through this schema before anything renders — an
 * envelope that fails validation is dropped LOUDLY (logged), never
 * silently coerced.
 *
 * Trace mapping: existing traceIds are cuid-shaped, not W3C 32-hex.
 * `toTraceparent` derives a deterministic W3C line (same traceId →
 * same traceparent, so correlation survives) while `correlationId`
 * keeps the original verbatim — the standards-compatible view never
 * replaces the native one.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
// Type-only relative import (erased at build) — same constraint and
// precedent as lib/observability/fleet-truth.ts: the worktree's
// node_modules junction resolves @nour/utils to the primary checkout,
// which can't see same-PR contract additions until merge. The runtime
// constants below re-declare the canonical values; the adapter test
// imports the canonical file RELATIVELY and pins equality, so drift
// fails a test instead of shipping.
import type { DomainEventEnvelope } from "../../../../packages/utils/src/contracts";

export type { DomainEventEnvelope };

/** Runtime mirror of contracts EVENT_ACTOR_TYPES — drift-pinned by test. */
export const EVENT_ACTOR_TYPES = [
  "operator",
  "agent",
  "system",
  "integration",
] as const;

/** Runtime mirror of contracts EVENT_PRIVACY_CLASSES — drift-pinned by test. */
export const EVENT_PRIVACY_CLASSES = [
  "public",
  "internal",
  "sensitive",
  "restricted",
] as const;

/** Runtime mirror of contracts eventTypeName — drift-pinned by test. */
export function eventTypeName(
  domain: string,
  entity: string,
  verb: string,
  major = 1,
): string {
  const seg = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return `com.statenour.${seg(domain)}.${seg(entity)}.${seg(verb)}.v${major}`;
}

export const domainEventEnvelopeSchema = z.object({
  specversion: z.literal("1.0"),
  id: z.string().min(1),
  source: z.string().min(1),
  type: z
    .string()
    .regex(
      /^com\.statenour\.[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\.v\d+$/,
      "type must be com.statenour.<domain>.<entity>.<verb>.v<major>",
    ),
  subject: z.string().optional(),
  time: z.string().datetime({ offset: true }).or(z.string().datetime()),
  datacontenttype: z.literal("application/json"),
  data: z.unknown(),
  schemaVersion: z.number().int().min(1),
  traceparent: z
    .string()
    .regex(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/)
    .optional(),
  correlationId: z.string().optional(),
  actorType: z.enum(EVENT_ACTOR_TYPES),
  actorId: z.string().optional(),
  receiptId: z.string().optional(),
  privacyClass: z.enum(EVENT_PRIVACY_CLASSES),
});

/** Deterministic W3C traceparent from a native trace/correlation id.
 *  version 00 · trace-id = sha256(traceId)[:32] · parent-id =
 *  sha256(traceId + eventId)[:16] · flags 00 (not sampled — this is a
 *  read-side mapping, not a live sampling decision). All-zero ids are
 *  invalid per spec; the hash of a non-empty string can't produce them
 *  for practical inputs, but guard anyway. */
export function toTraceparent(traceId: string, eventId: string): string | undefined {
  if (!traceId) return undefined;
  const traceHex = createHash("sha256").update(traceId).digest("hex").slice(0, 32);
  const parentHex = createHash("sha256")
    .update(`${traceId}:${eventId}`)
    .digest("hex")
    .slice(0, 16);
  if (/^0+$/.test(traceHex) || /^0+$/.test(parentHex)) return undefined;
  return `00-${traceHex}-${parentHex}-00`;
}

/** Validate; returns the typed envelope or null (caller logs the drop). */
export function validateEnvelope(
  candidate: unknown,
): DomainEventEnvelope | null {
  const r = domainEventEnvelopeSchema.safeParse(candidate);
  return r.success ? (r.data as DomainEventEnvelope) : null;
}
