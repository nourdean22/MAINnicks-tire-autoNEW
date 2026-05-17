/**
 * GET /api/system/persona-drift · v10.0.529.38 · Arc B Feature 4
 *
 * Owner-gated read of recent persona-drift events for the dedicated
 * PersonaDriftCard surface. Excludes dismissed (soft-deleted) rows
 * AND snoozed-not-yet-expired rows.
 *
 * Read-only · no mutation, no AI cost. Mutation lives in the sibling
 * /api/system/persona-drift/[key]/resolve route.
 */

import { apiHandler } from "@/lib/utils/http";
import { loadActiveDrifts } from "@/lib/brain/persona-drift-detector";

export const GET = apiHandler(
  async () => {
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
  },
  { auth: "owner" },
);
