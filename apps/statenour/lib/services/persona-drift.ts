/**
 * lib/services/persona-drift.ts · Phase B.6c (2026-05-22 ·
 * legacy-modernizer REST→tRPC ultron slice · system-domain sub-slice).
 *
 * The persona-drift read/resolve assembly · lifted verbatim from
 * app/api/system/persona-drift/route.ts (the GET's row-mapping +
 * summary) and app/api/system/persona-drift/[key]/resolve/route.ts (the
 * resolve wrapper) so the legacy REST endpoints AND the new
 * `system.personaDrift` / `system.resolvePersonaDrift` tRPC procedures
 * call the SAME functions · drift between consumers structurally
 * impossible.
 *
 * `listPersonaDrifts` returns the explicit, shallow `PersonaDriftView`
 * shape — `loadActiveDrifts` already returns plain `StoredDrift`
 * objects (parsed from a JSON content column, no Prisma Json type), so
 * there is no recursive type to firewall; the explicit interface keeps
 * the public procedure type pinned regardless.
 */

import { ServiceError } from "@/lib/utils/service-error";
import {
  loadActiveDrifts,
  resolveDriftEvent,
  type DriftResolution,
} from "@/lib/brain/persona-drift-detector";

/** One persona-drift event row · camelCase, the shape the card renders. */
export interface PersonaDriftRow {
  key: string;
  messageId: string;
  conversationId: string;
  similarity: number;
  drift: number;
  excerpt: string;
  detectedAt: string;
  personaSnapshotAt: string;
  createdAt: string;
}

/** Shallow, explicit shape for the persona-drift GET view. */
export interface PersonaDriftView {
  items: PersonaDriftRow[];
  summary: { total: number; strongest: number | null };
}

/** Shallow, explicit shape for a persona-drift resolve result. */
export interface PersonaDriftResolveResult {
  ok: true;
  key: string;
  resolution: DriftResolution;
}

/**
 * Load active persona-drift events for the review card (7d window,
 * dismissed + snoozed-not-expired filtered out). The route and the
 * tRPC `system.personaDrift` procedure both call this.
 */
export async function listPersonaDrifts(): Promise<PersonaDriftView> {
  const items = await loadActiveDrifts(7);
  return {
    items: items.map((d) => ({
      key: d.key,
      messageId: d.message_id,
      conversationId: d.conversation_id,
      similarity: d.similarity,
      drift: d.drift,
      excerpt: d.excerpt,
      detectedAt: d.detected_at,
      personaSnapshotAt: d.persona_snapshot_at,
      createdAt: d.createdAt,
    })),
    summary: {
      total: items.length,
      strongest: items[0]?.drift ?? null,
    },
  };
}

/**
 * Resolve a persona-drift event (dismiss · snooze · acknowledge). A
 * missing key throws ServiceError(404) so both transports reject
 * identically. The route and the tRPC `system.resolvePersonaDrift`
 * procedure both call this.
 */
export async function resolvePersonaDrift(input: {
  key: string;
  resolution: DriftResolution;
  note?: string;
}): Promise<PersonaDriftResolveResult> {
  const result = await resolveDriftEvent(
    input.key,
    input.resolution,
    input.note?.trim() || undefined,
  );
  if (!result.ok) {
    throw new ServiceError("not_found", 404);
  }
  return { ok: true, key: input.key, resolution: input.resolution };
}
