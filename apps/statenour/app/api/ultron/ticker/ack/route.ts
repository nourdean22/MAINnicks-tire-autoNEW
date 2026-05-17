/**
 * POST /api/ultron/ticker/ack · May 02
 *
 * Records a ticker-item acknowledgment. Fires when Nour clicks × on
 * a top- or bottom-ticker cell — "exit means I acknowledge it." The
 * client also stores the ID in localStorage to hide the cell across
 * reloads; this endpoint persists the SIGNAL on the server so brain
 * pipelines (insight surfacer, idle-prompt detector, etc.) know
 * Nour saw + acknowledged the item rather than missed it.
 *
 * Body: { itemId: string, kind?: string, source?: "top" | "bottom" }
 *
 * Effect: writes a single AuditEvent row with eventType
 * "ticker_acknowledged". No DB schema change — AuditEvent already
 * has eventType + payload + actor; we just stamp a new event-type
 * value. Retention will sweep these on the standard generic 90d
 * window.
 *
 * Auth: owner session (same as every personal write).
 */

import { z } from "zod";
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { currentActor } from "@/lib/db/actor";

export const dynamic = "force-dynamic";

const ackSchema = z.object({
  itemId: z.string().min(1).max(200),
  kind: z.string().max(60).optional(),
  source: z.enum(["top", "bottom"]).optional(),
});

export const POST = apiHandler(async (req) => {
  const body = await readRequestJson(req);
  const { itemId, kind, source } = ackSchema.parse(body);

  await prisma.auditEvent.create({
    data: {
      eventType: "ticker_acknowledged",
      actor: currentActor() ?? "user",
      detail: `${source ?? "?"}:${kind ?? "?"}:${itemId}`,
      payload: { itemId, kind: kind ?? null, source: source ?? null },
    },
  });

  return { ok: true };
}, { auth: "owner" });
