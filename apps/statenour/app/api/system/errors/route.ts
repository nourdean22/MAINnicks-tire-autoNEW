import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { parsePagination, parseDateRange } from "@/lib/db/query-helpers";

/** GET /api/system/errors — Recent errors with grouping and filtering */
export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const grouped = url.searchParams.get("grouped") === "true";
  const level = url.searchParams.get("level") ?? undefined;
  const { from, to } = parseDateRange(req);
  const pagination = parsePagination(req);

  const where = {
    ...(level && { level }),
    createdAt: {
      ...(from && { gte: from }),
      ...(to && { lte: to }),
    },
  };

  if (grouped) {
    // Return top 20 most frequent errors
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
        message: e.message,
        count: e._count.id,
        lastSeen: e._max.createdAt,
      })),
    };
  }

  // Paginated list
  const page = Math.max(1, pagination.page ?? 1);
  const pageSize = Math.min(100, pagination.pageSize ?? 20);

  const [data, total] = await Promise.all([
    prisma.errorLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.errorLog.count({ where }),
  ]);

  return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}, { auth: "owner" }); // v9.1.14 · was leaking server error log + stack traces

/**
 * DELETE /api/system/errors — bulk-purge errors.
 *
 * Query params (require at least one — refuses to nuke everything):
 *   ?message=<substring>   Case-insensitive contains match.
 *   ?level=<error|warn|fatal>
 *   ?olderThan=<ISO>       Only delete rows strictly before this date.
 *
 * Returns { deleted: number }. Used from the /system/errors page's
 * "clear fingerprint" button and one-off cleanups (e.g., after
 * fixing a bug that spammed the log).
 */
export const DELETE = apiHandler(async (req) => {
  const url = new URL(req.url);
  const message = url.searchParams.get("message");
  const level = url.searchParams.get("level");
  const olderThanRaw = url.searchParams.get("olderThan");

  if (!message && !level && !olderThanRaw) {
    throw Object.assign(new Error("At least one filter required"), {
      status: 400,
      code: "FILTER_REQUIRED",
    });
  }

  const where: Parameters<typeof prisma.errorLog.deleteMany>[0] extends
    | { where?: infer W }
    | undefined
    ? W
    : never = {
    ...(message && { message: { contains: message, mode: "insensitive" as const } }),
    ...(level && { level }),
    ...(olderThanRaw && { createdAt: { lt: new Date(olderThanRaw) } }),
  };

  const result = await prisma.errorLog.deleteMany({ where });
  return { deleted: result.count };
}, { auth: "owner" }); // v9.1.14 · DELETE was unauthed — would let anyone purge server errors
