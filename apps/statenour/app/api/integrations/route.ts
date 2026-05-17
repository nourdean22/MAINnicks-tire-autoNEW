import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { paginate, parsePagination } from "@/lib/db/query-helpers";
import { ServiceError } from "@/lib/utils/service-error";

// v10.0.44 — auth: "owner" added to both. Integration manifest +
// healthCheckUrl + config blob are operator-private; POST creates
// rows that drive cron+brain behaviour.
//
// 2026-05-01 — `syncLogs` include removed. The IntegrationSyncLog
// table was retired Apr 18 (see schema.prisma:1213) but this route
// kept including it, returning 500 on every call. Last-sync data
// now derived from `lastSyncAt` column on the Integration row
// itself, which is already populated by the OAuth refresh path.
/** GET /api/integrations — List all integrations */
export const GET = apiHandler(async (req) => {
  const pagination = parsePagination(req);
  return paginate(prisma.integration, pagination, {
    orderBy: { name: "asc" },
  });
}, { auth: "owner" });

/** POST /api/integrations — Register a new integration */
export const POST = apiHandler(async (req) => {
  const body = await req.json();
  if (!body.name) throw new ServiceError("name is required", 400);

  return prisma.integration.create({
    data: {
      name: body.name,
      type: body.type ?? "api",
      enabled: body.enabled ?? true,
      config: body.config ?? null,
      healthCheckUrl: body.healthCheckUrl ?? null,
      metadata: body.metadata ?? null,
    },
  });
}, { auth: "owner" });
