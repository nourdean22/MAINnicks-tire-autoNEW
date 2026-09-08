/**
 * Plate-read retention · 2026-09-08 (ADR-0017 section 7, master plan
 * sections 14 and 17): a plate read lives 30 days unless it matched a
 * plate the customer gave us. DeviceEvent rows themselves stay for the
 * 90-day window (dwell / visit analytics); only the plate TEXT goes, and
 * the row records when it went so the cockpit can say "scrubbed", not "none".
 *
 * Raw SQL on purpose: one indexed UPDATE over `created_at` beats paging
 * every camera event through Prisma nightly. Columns are the mapped
 * snake_case names (`device_events.created_at`); JSON keys are the
 * contract's camelCase.
 */
import { prisma } from "@/lib/prisma";

export const PLATE_RETENTION_DAYS = 30;

/** Null out plate text on unlinked camera events older than the window. Returns rows scrubbed. */
export async function scrubExpiredPlates(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PLATE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const scrubbedAt = now.toISOString();
  return prisma.$executeRaw`
    UPDATE device_events
    SET data = jsonb_set(
                 jsonb_set(data, '{plate,text}', 'null'::jsonb, false),
                 '{plate,normalizedText}', 'null'::jsonb, false
               ) || jsonb_build_object('plateScrubbedAt', ${scrubbedAt}::text)
    WHERE event = 'vehicle_detected'
      AND created_at < ${cutoff}
      AND jsonb_typeof(data->'plate'->'text') = 'string'
      AND COALESCE(data->'customerRef'->>'status', '') <> 'matched'
  `;
}
