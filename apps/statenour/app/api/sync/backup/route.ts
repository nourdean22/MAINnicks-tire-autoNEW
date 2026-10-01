import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { toDailyDigestPayload } from "@/lib/nickstire/daily-digest";

/**
 * POST /api/sync/backup
 * Receives nickstire's counts-only daily digest (not a restorable backup).
 * Stores it as an audit event for historical tracking.
 *
 * Q-29: the body is reduced to its count keys before it is stored, so a stale
 * sender's customer rows never reach audit_events. The route path, actor and
 * eventType are unchanged for compatibility.
 */
export const POST = apiHandler(async (req) => {
  const payload = toDailyDigestPayload(await req.json());
  const n = (value: number | null) => value ?? 0;

  await prisma.auditEvent.create({
    data: {
      actor: "nickstire-backup",
      eventType: "daily_backup",
      detail: `Daily digest: ${n(payload.counts.leads)} leads, ${n(payload.counts.invoices)} invoices, ${n(payload.counts.customers)} customers`,
      payload: { ...payload },
    },
  });

  return { ok: true, message: "Digest stored" };
}, { auth: "sync" });

/**
 * GET: Return the latest digest. Rows written before Q-29 may still hold row
 * copies in the database, so the payload is reduced to its counts on the way out.
 */
export const GET = apiHandler(async () => {
  const latest = await prisma.auditEvent.findFirst({
    where: { eventType: "daily_backup" },
    orderBy: { createdAt: "desc" },
  });

  return { backup: latest ? toDailyDigestPayload(latest.payload) : null, date: latest?.createdAt || null };
}, { auth: "sync" });
