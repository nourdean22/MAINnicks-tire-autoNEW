import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";

/**
 * POST /api/sync/backup
 * Receives daily backup snapshots from nickstire.org.
 * Stores as audit events for historical tracking.
 */
export const POST = apiHandler(async (req) => {
  const data = await req.json();

  await prisma.auditEvent.create({
    data: {
      actor: "nickstire-backup",
      eventType: "daily_backup",
      detail: `Daily backup: ${data.counts?.leads || 0} leads, ${data.counts?.invoices || 0} invoices, ${data.counts?.customers || 0} customers`,
      payload: data,
    },
  });

  return { ok: true, message: "Backup stored" };
}, { auth: "sync" });

/** GET: Return latest backup snapshot */
export const GET = apiHandler(async () => {
  const latest = await prisma.auditEvent.findFirst({
    where: { eventType: "daily_backup" },
    orderBy: { createdAt: "desc" },
  });

  return { backup: latest?.payload || null, date: latest?.createdAt || null };
}, { auth: "sync" });
