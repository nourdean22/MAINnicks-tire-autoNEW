/**
 * POST /api/devices/retire-stale — G6 bulk retire.
 *
 * Retires every SmartDevice with status=OFFLINE + lastSeenAt older
 * than `olderThanDays` (default 7). Owner-auth. Confirmation is the
 * client's job (UI modal).
 *
 * Backstory: Apr 14 — local-agent died. 20/21 devices went offline.
 * They've been showing as red rows on /system/devices ever since.
 * This lets Nour nuke the corpse in one shot instead of clicking
 * 20 delete buttons.
 */
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

interface RetireBody {
  olderThanDays?: number;
  // optional explicit status filter; default ["OFFLINE", "UNKNOWN", "ERROR"]
  statuses?: string[];
  // dry-run: return the list of candidates without deleting
  dryRun?: boolean;
}

export const POST = apiHandler(
  async (req) => {
    const body = (await readRequestJson<RetireBody>(req).catch(() => ({}))) as RetireBody;
    const olderThanDays = body.olderThanDays ?? 7;
    const statuses = body.statuses ?? ["OFFLINE", "UNKNOWN", "ERROR"];
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    const candidates = await prisma.smartDevice.findMany({
      where: {
        status: { in: statuses },
        OR: [
          { lastSeenAt: { lt: cutoff } },
          { lastSeenAt: null },
        ],
      },
      select: { id: true, name: true, platform: true, lastSeenAt: true, status: true },
    });

    if (body.dryRun) {
      return { ok: true, dryRun: true, count: candidates.length, candidates };
    }

    if (candidates.length === 0) {
      return { ok: true, retired: 0, candidates: [] };
    }

    const ids = candidates.map((c) => c.id);
    // 2026-09-07 (D11) · retirement is a lifecycle DECISION, not a purge.
    // Mark the rows RETIRED: they leave every health count (system-pulse
    // classifyDevices skips RETIRED) while the device, its events and its
    // commands stay inspectable. The old path hard-deleted all three.
    const retired = await prisma.smartDevice.updateMany({
      where: { id: { in: ids } },
      data: { status: "RETIRED" },
    });

    return {
      ok: true,
      retired: retired.count,
      candidates: candidates.map((c) => ({ id: c.id, name: c.name })),
    };
  },
  { auth: "owner" },
);
