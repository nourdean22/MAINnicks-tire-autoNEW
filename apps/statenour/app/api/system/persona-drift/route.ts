/**
 * GET /api/system/persona-drift · v10.0.529.38 · Arc B Feature 4
 *
 * Owner-gated read of recent persona-drift events for the dedicated
 * PersonaDriftCard surface. Excludes dismissed (soft-deleted) rows
 * AND snoozed-not-yet-expired rows.
 *
 * Read-only · no mutation, no AI cost. Mutation lives in the sibling
 * /api/system/persona-drift/[key]/resolve route.
 */

import { apiHandler } from "@/lib/utils/http";
// Phase B.6c · the read assembly moved to a shared service so the
// legacy REST route AND the tRPC `system.personaDrift` procedure call
// the same function · drift impossible.
import { listPersonaDrifts } from "@/lib/services/persona-drift";

export const GET = apiHandler(
  async () => {
    return listPersonaDrifts();
  },
  { auth: "owner" },
);
