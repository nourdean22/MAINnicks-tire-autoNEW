import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";

// ── Pagination ─────────────────────────────────────────────────────────

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Standardized pagination for any Prisma model.
 * Usage: paginate(prisma.task, { page: 1, pageSize: 20 }, { where: { status: "DOING" } })
 */
export async function paginate<T>(
  model: { findMany: Function; count: Function },
  pagination: PaginationParams = {},
  queryArgs: Record<string, unknown> = {}
): Promise<PaginatedResult<T>> {
  const page = Math.max(1, pagination.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, pagination.pageSize ?? 20));
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    model.findMany({
      ...queryArgs,
      skip,
      take: pageSize,
    }),
    model.count({ where: (queryArgs as any).where }),
  ]);

  return {
    data: data as T[],
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// ── Find or throw ──────────────────────────────────────────────────────

/**
 * Find a record or throw a 404 ServiceError.
 * Usage: const task = await findOrThrow(prisma.task, { id }, "Task not found")
 */
export async function findOrThrow<T>(
  model: { findUnique: Function },
  where: Record<string, unknown>,
  errorMsg = "Record not found"
): Promise<T> {
  const result = await model.findUnique({ where });
  if (!result) {
    throw new ServiceError(errorMsg, 404);
  }
  return result as T;
}

// ── Safe transaction ───────────────────────────────────────────────────

/**
 * Wraps prisma.$transaction with retry logic for transient errors.
 * Retries once on connection/timeout errors.
 */
export async function safeTransaction<T>(
  fn: (tx: typeof prisma) => Promise<T>,
  maxRetries = 1
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return (await prisma.$transaction(fn as never, {
        timeout: 10000, // 10s timeout
      })) as T;
    } catch (error: unknown) {
      lastError = error;
      const isRetryable =
        error instanceof Error &&
        (error.message.includes("timed out") ||
          error.message.includes("connection") ||
          error.message.includes("ECONNREFUSED"));

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      // Wait before retry with exponential backoff
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }

  throw lastError;
}

// ── Parse pagination from URL ──────────────────────────────────────────

/**
 * Extract pagination params from a request URL.
 * Usage: const { page, pageSize } = parsePagination(request)
 */
export function parsePagination(request: Request): PaginationParams {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") ?? "1", 10);
  const pageSize = parseInt(url.searchParams.get("pageSize") ?? "20", 10);
  return {
    page: isNaN(page) ? 1 : page,
    pageSize: isNaN(pageSize) ? 20 : pageSize,
  };
}

// ── Parse date range from URL ──────────────────────────────────────────

export interface DateRange {
  from?: Date;
  to?: Date;
}

export function parseDateRange(request: Request): DateRange {
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  return {
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  };
}
