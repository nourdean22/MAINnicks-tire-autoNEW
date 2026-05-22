import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { getPolicy, type ApprovalClass } from "@/lib/automation/policy";
import { updatePolicyFields } from "@/lib/services/system-pages-b";
import { ServiceError } from "@/lib/utils/service-error";

/**
 * GET / PATCH /api/system/policies/:id
 *
 * GET   — return the policy record (404 if missing/retired)
 * PATCH — operator-facing edits, body shape:
 *   { approvalClass?: "auto"|"pending"|"forbidden",
 *     enabled?: boolean,
 *     notes?: string|null }
 *
 * Multiple fields can change in one PATCH. Each field is applied
 * sequentially through the service-layer helpers so the audit log
 * captures separate "approval_class_changed", "policy_enabled_changed",
 * etc. events rather than collapsing them into one mutation.
 *
 * Owner-only. The page that drives this endpoint is /system/policies.
 *
 * Phase B.7b (2026-05-22 · legacy-modernizer REST→tRPC system-pages
 * slice) · the PATCH multi-field-edit logic moved to the shared
 * `lib/services/system-pages-b.updatePolicyFields` service · this route
 * AND the new `trpc.system.updatePolicy` procedure call the same
 * function · drift impossible. The route stays mounted as the rollback
 * path. (The single-policy GET keeps using `getPolicy` directly · no
 * tRPC consumer for that mode in this slice.)
 */

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async (_req, { params }) => {
    const { id } = await params!;
    const policy = await getPolicy(id);
    if (!policy) {
      throw new ServiceError(`policy "${id}" not found`, 404);
    }
    return policy;
  },
  { auth: "owner" },
);

export const PATCH = apiHandler(
  async (req, { params }) => {
    const { id } = await params!;
    const body = (await readRequestJson(req)) as {
      approvalClass?: ApprovalClass;
      enabled?: boolean;
      notes?: string | null;
    };

    return updatePolicyFields({
      id,
      approvalClass: body.approvalClass,
      enabled: body.enabled,
      notes: body.notes,
    });
  },
  { auth: "owner" },
);
