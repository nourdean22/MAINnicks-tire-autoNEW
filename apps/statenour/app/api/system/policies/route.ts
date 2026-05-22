import { apiHandler } from "@/lib/utils/http";
import {
  type PolicySurface,
  type ApprovalClass,
} from "@/lib/automation/policy";
import { listPoliciesView } from "@/lib/services/system-pages-b";

/**
 * GET /api/system/policies — read-only registry feed for /system/policies.
 *
 * Owner-only (operator-private governance data). Optional filters:
 *   ?surface=cron|tool|slash|autonomous-action|webhook
 *   ?approvalClass=auto|pending|forbidden
 *   ?enabledOnly=1
 *
 * Phase B.7b (2026-05-22 · legacy-modernizer REST→tRPC system-pages
 * slice) · delegates to the shared
 * `lib/services/system-pages-b.listPoliciesView` service · this route
 * AND the new `trpc.system.policies` procedure call the same function ·
 * drift impossible. The route stays mounted as the rollback path.
 */
export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const surface = url.searchParams.get("surface") as PolicySurface | null;
  const approvalClass = url.searchParams.get(
    "approvalClass",
  ) as ApprovalClass | null;
  const enabledOnly = url.searchParams.get("enabledOnly") === "1";

  return listPoliciesView({
    surface: surface ?? undefined,
    approvalClass: approvalClass ?? undefined,
    enabledOnly,
  });
}, { auth: "owner" });
