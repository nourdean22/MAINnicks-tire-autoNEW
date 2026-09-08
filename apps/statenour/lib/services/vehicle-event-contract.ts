/**
 * Vehicle-arrival event contract v2 (ADR-0017, master plan section 6.4):
 * the zod shape of what the edge (camera-bridge/visitd) posts to
 * POST /api/devices/{id}/events. Shared by the ingest
 * (lib/services/vehicle-detection.ts) and the route's non-writing dry-run
 * validation (gate G0), so both judge a payload by the same rules.
 *
 * Permissive on purpose: unknown fields pass through and are stored
 * verbatim; v1 payloads (trackId only, no eventId / visitId) still validate.
 */
import { z } from "zod";

const PlateSchema = z
  .object({
    status: z.string().optional(),
    text: z.string().optional(),
    normalizedText: z.string().optional(),
    state: z.string().optional(),
    confidence: z.number().optional(),
    provider: z.string().optional(),
    reads: z.number().optional(),
    knownName: z.string().optional(),
  })
  .passthrough();

const DataSchema = z
  .object({
    cameraId: z.string().optional(),
    cameraName: z.string().optional(),
    visitId: z.string().optional(),
    sightingId: z.string().optional(),
    trackId: z.string().nullable().optional(),
    zone: z.string().optional(),
    zoneName: z.string().optional(),
    state: z.string().optional(),
    priority: z.string().optional(),
    label: z.string().optional(),
    confidence: z.number().optional(),
    dwellSeconds: z.number().optional(),
    zoneDwell: z.record(z.string(), z.number()).optional(),
    stationary: z.boolean().optional(),
    estimated: z.boolean().optional(),
    plate: PlateSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const VehicleEventSchema = z
  .object({
    schemaVersion: z.number().optional(),
    event: z.string().optional(),
    eventId: z.string().optional(),
    source: z.string().optional(),
    timestamp: z.string().optional(),
    data: DataSchema.optional(),
  })
  .passthrough();

/** States that page the operator (Telegram + push); every other state is stored silently. */
export const ALERT_STATES: ReadonlySet<string> = new Set(["CONFIRMED_ARRIVAL", "ENTERED_ZONE"]);
