import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { paginate, parsePagination } from "@/lib/db/query-helpers";
import { ServiceError } from "@/lib/utils/service-error";
import {
  INTEGRATION_VIEW_SELECT,
  toIntegrationView,
} from "@/lib/services/integration-view";

// v10.0.44 — auth: "owner" added to both. Integration manifest +
// healthCheckUrl + config blob are operator-private; POST creates
// rows that drive cron+brain behaviour.
//
// 2026-05-01 — `syncLogs` include removed. The IntegrationSyncLog
// table was retired Apr 18 (see schema.prisma:1213) but this route
// kept including it, returning 500 on every call. Last-sync data
// now derived from `lastSyncAt` column on the Integration row
// itself, which is already populated by the OAuth refresh path.
//
// 2026-09-02 audit C-1 + same-day self-audit — SECRETS NEVER LEAVE THIS ROUTE.
// Both verbs used to return the raw model. `config` is where
// lib/services/google-oauth.ts stores the Google refresh + access token in
// cleartext, so GET listed them and POST echoed back whatever was just
// written. Owner-gated, but a long-lived credential in an HTTP body reaches
// devtools, saved HARs and any client-side error reporter.
//
// The projection now lives in lib/services/integration-view.ts, deliberately
// as ONE function both verbs call: the first pass at this fix patched GET and
// left POST, which is what a second exit always invites. Read that file for
// why `config` is still SELECTed (key names are derived from it) and why that
// is a weaker claim than never reading it.

/** GET /api/integrations — List all integrations (secrets reduced to key names) */
export const GET = apiHandler(async (req) => {
  const pagination = parsePagination(req);
  const page = await paginate<Record<string, unknown>>(prisma.integration, pagination, {
    orderBy: { name: "asc" },
    select: INTEGRATION_VIEW_SELECT,
  });
  return { ...page, data: page.data.map(toIntegrationView) };
}, { auth: "owner" });

/** POST /api/integrations — Register a new integration */
export const POST = apiHandler(async (req) => {
  const body = await req.json();
  if (!body.name) throw new ServiceError("name is required", 400);

  const created = await prisma.integration.create({
    data: {
      name: body.name,
      type: body.type ?? "api",
      enabled: body.enabled ?? true,
      config: body.config ?? null,
      healthCheckUrl: body.healthCheckUrl ?? null,
      metadata: body.metadata ?? null,
    },
    select: INTEGRATION_VIEW_SELECT,
  });
  return toIntegrationView(created);
}, { auth: "owner" });
