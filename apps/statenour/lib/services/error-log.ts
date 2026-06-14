/**
 * lib/services/error-log.ts · Phase VV (2026-05-22 ·
 * legacy-modernizer REST→tRPC system slice).
 *
 * ErrorLog read helpers. Lifted verbatim from the GET branch of
 * app/api/system/errors/route.ts so the legacy REST endpoint AND the
 * new `system.errorsGrouped` / `system.errorsRecent` tRPC procedures
 * call the same functions · drift between consumers structurally
 * impossible.
 *
 * The legacy route multiplexed two shapes off one URL (`?grouped=true`
 * vs paginated). The tRPC layer splits them into two named procedures
 * so each has its own typed return — but the underlying queries are
 * byte-for-byte the route's.
 *
 * The DELETE branch (bulk purge) stays REST-only · no tRPC consumer
 * in this slice.
 */

import { prisma } from "@/lib/prisma";
import { sanitizeError, redactSensitive } from "@/lib/utils/sanitize-error";

/**
 * Top-20 most-frequent errors, grouped by message.
 *
 * `from` (Phase B.6c · ultron HQErrorsCard) is an optional lower-bound
 * on `createdAt` — the card passes a 24h-ago cutoff so its rose/amber
 * threshold reads a true 24h window. Omitting it scans the whole log
 * (the components/system/* ErrorsFingerprints behavior, unchanged).
 */
export async function listGroupedErrors(opts?: { level?: string; from?: Date }) {
  const level = opts?.level;
  const from = opts?.from;
  const where = {
    ...(level && { level }),
    ...(from && { createdAt: { gte: from } }),
  };
  const errors = await prisma.errorLog.groupBy({
    by: ["message"],
    where,
    _count: { id: true },
    _max: { createdAt: true },
    orderBy: { _count: { id: "desc" } },
    take: 20,
  });
  return {
    groups: errors.map((e) => ({
      message: sanitizeError(e.message),
      count: e._count.id,
      lastSeen: e._max.createdAt,
    })),
  };
}

/** Paginated recent-errors feed (newest first). */
export async function listRecentErrors(opts: {
  level?: string;
  page?: number;
  pageSize?: number;
}) {
  const where = {
    ...(opts.level && { level: opts.level }),
  };
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, opts.pageSize ?? 20);

  const [data, total] = await Promise.all([
    prisma.errorLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.errorLog.count({ where }),
  ]);

  return {
    data: data.map((r) => ({
      id: r.id,
      level: r.level,
      message: sanitizeError(r.message),
      stack: r.stack ? sanitizeError(r.stack) : null,
      context: redactSensitive(r.context) ?? null,
      createdAt: r.createdAt,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
