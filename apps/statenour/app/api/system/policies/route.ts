import { apiHandler } from "@/lib/utils/http";
import {
  listPolicies,
  type PolicySurface,
  type ApprovalClass,
} from "@/lib/automation/policy";

/**
 * GET /api/system/policies — read-only registry feed for /system/policies.
 *
 * Owner-only (operator-private governance data). Optional filters:
 *   ?surface=cron|tool|slash|autonomous-action|webhook
 *   ?approvalClass=auto|pending|forbidden
 *   ?enabledOnly=1
 *
 * Pre-fix (v10.0.147 and earlier) the rules deciding which actions
 * auto-fire vs queue for approval were scattered across cron files,
 * tool defs, and chat interceptors. v10.0.148 adds the AutomationPolicy
 * table as the canonical governance spine; this endpoint surfaces it.
 */
export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const surface = url.searchParams.get("surface") as PolicySurface | null;
  const approvalClass = url.searchParams.get("approvalClass") as ApprovalClass | null;
  const enabledOnly = url.searchParams.get("enabledOnly") === "1";

  const policies = await listPolicies({
    surface: surface ?? undefined,
    approvalClass: approvalClass ?? undefined,
    enabledOnly,
  });

  return {
    count: policies.length,
    policies,
  };
}, { auth: "owner" });
