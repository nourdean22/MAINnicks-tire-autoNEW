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
// 2026-09-02 deep-research audit (C-1) — `config` NO LONGER LEAVES THE SERVER.
// This route paginated the raw model with no `select`, so every column shipped
// to the client, and `config` is where lib/services/google-oauth.ts stores the
// Google **refresh token** and access token in cleartext (see its upsert of
// `stored: StoredToken`). A refresh token is long-lived: once it reaches a
// browser it is in memory, in devtools, in any HAR the operator saves, and in
// reach of any client-side error reporter. Nothing in this repo ever read the
// field from this route (grepped app/, components/, lib/, features/, hooks/),
// so scoping the select removes an exposure and breaks no consumer.
//
// The shape stays useful for a future settings UI without emitting secrets:
// `configKeys` names WHICH keys are present, never their values, so "is the
// refresh token stored?" is still answerable from the client. Server-side
// readers are unaffected — they query Prisma directly.
const INTEGRATION_PUBLIC_SELECT = {
  id: true,
  name: true,
  type: true,
  enabled: true,
  status: true,
  lastSyncAt: true,
  nextSyncAt: true,
  healthCheckUrl: true,
  errorCount: true,
  consecutiveFailures: true,
  createdAt: true,
  updatedAt: true,
  config: true, // stripped below — selected only to derive configKeys
} as const;

/** Key names present in a config blob. Never values. */
export function configKeyNames(config: unknown): string[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  return Object.keys(config as Record<string, unknown>).sort();
}

/** GET /api/integrations — List all integrations (secrets stripped) */
export const GET = apiHandler(async (req) => {
  const pagination = parsePagination(req);
  const page = await paginate<Record<string, unknown>>(prisma.integration, pagination, {
    orderBy: { name: "asc" },
    select: INTEGRATION_PUBLIC_SELECT,
  });
  return {
    ...page,
    data: page.data.map(({ config, ...row }) => ({
      ...row,
      hasConfig: Boolean(config),
      configKeys: configKeyNames(config),
    })),
  };
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
