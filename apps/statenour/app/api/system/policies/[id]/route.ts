import { apiHandler, readRequestJson } from "@/lib/utils/http";
import {
  getPolicy,
  setApprovalClass,
  setEnabled,
  updateNotes,
  type ApprovalClass,
} from "@/lib/automation/policy";
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

    let result = await getPolicy(id);
    if (!result) throw new ServiceError(`policy "${id}" not found`, 404);

    if (typeof body.approvalClass === "string") {
      result = await setApprovalClass(id, body.approvalClass);
    }
    if (typeof body.enabled === "boolean") {
      result = await setEnabled(id, body.enabled);
    }
    if (body.notes !== undefined) {
      result = await updateNotes(id, body.notes);
    }
    return result;
  },
  { auth: "owner" },
);
