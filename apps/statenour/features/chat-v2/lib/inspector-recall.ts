/**
 * The chat memory inspector's read: what recall returns for the last user
 * turn (2026-10-01).
 *
 * Two defects lived in the inline fetch this replaces (chat-island.tsx):
 *
 *  1. GET /api/brain/recall runs inside apiHandler, which wraps the report as
 *     { ok, data, meta }. The inline `(await res.json()) as {...}` read that
 *     wrapper, so `hits` and `provenance` were always undefined: the
 *     inspector showed zero memories on every open, and blanked the
 *     provenance the chat stream had just delivered. apiFetch unwraps it.
 *  2. It ran recall with side effects: every hit's lastSeen was bumped, a
 *     14-day boost in real chat recall, and the recall-quality metric got a
 *     second sample per turn. recallPreviewUrl sends preview=1, the
 *     read-only path.
 *
 * tests/components/chat-inspector-recall-envelope.test.ts sends this through
 * the real route, inside the real apiHandler.
 */
import { apiFetch } from "@/lib/utils/api-fetch";
import { recallPreviewUrl } from "@/lib/brain/recall-preview-url";
import type { MemoryHit } from "../stores/chat-ui-store";

type RecallProvenance = "OK" | "ZERO" | "ERROR" | "UNMEASURED";

type RecallReportBody = {
  hits?: Array<{ id?: string; memoryId?: string; content?: string; category?: string; similarity?: number; knnDistance?: number }>;
  provenance?: RecallProvenance;
  provenanceReason?: string;
};

export type InspectorRecall = {
  hits: MemoryHit[];
  provenance?: RecallProvenance;
  provenanceReason?: string;
};

export async function fetchInspectorRecall(lastUserText: string, signal?: AbortSignal): Promise<InspectorRecall> {
  const report = await apiFetch<RecallReportBody>(recallPreviewUrl(lastUserText.slice(0, 1000)), { signal });
  const hits = (report.hits ?? []).map((hit, index) => ({
    id: hit.id ?? hit.memoryId ?? `hit-${index}`,
    content: hit.content ?? "",
    category: hit.category ?? "memory",
    similarity: typeof hit.similarity === "number"
      ? hit.similarity
      : typeof hit.knnDistance === "number"
        ? Math.max(0, Math.min(1, 1 - hit.knnDistance))
        : 0,
  }));
  return { hits, provenance: report.provenance, provenanceReason: report.provenanceReason };
}
