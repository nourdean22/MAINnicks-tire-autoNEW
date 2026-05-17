import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";

/** Latest normalized Nick's Tire CEO context (from v2 sync ingest). */
export const GET = apiHandler(async () => {
  const latest = await prisma.auditEvent.findFirst({
    where: { eventType: "ceo_business_context" },
    orderBy: { createdAt: "desc" },
  });

  if (!latest?.payload) {
    return { context: null, message: "No CEO context synced yet" };
  }

  return {
    context: latest.payload,
    syncedAt: latest.createdAt,
  };
}, { auth: "sync" });
