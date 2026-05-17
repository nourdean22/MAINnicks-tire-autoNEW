import { apiHandler, readRequestJson } from "@/lib/utils/http";
import {
  decidePendingAction,
  type ApprovalDecision,
} from "@/lib/automation/approval-queue";
import { ServiceError } from "@/lib/utils/service-error";

/**
 * POST /api/system/approvals/[id] · v10.0.153
 *
 * Decide one pending AutonomousAction row.
 *
 * Body:
 *   { decision: "approved" | "rejected", notes?: string }
 *
 * Returns the updated row. 404 if id missing, 409 if the row is
 * not in pending state. Owner-gated.
 */
export const dynamic = "force-dynamic";

const VALID_DECISIONS: ApprovalDecision[] = ["approved", "rejected"];

export const POST = apiHandler(
  async (req, { params }) => {
    const { id } = await params!;
    const body = (await readRequestJson(req)) as {
      decision?: string;
      notes?: string;
    };
    const decision = body.decision as ApprovalDecision | undefined;
    if (!decision || !VALID_DECISIONS.includes(decision)) {
      throw new ServiceError(
        `decision must be "approved" or "rejected" (got "${body.decision}")`,
        400,
      );
    }
    return decidePendingAction(id, decision, "nour", body.notes);
  },
  { auth: "owner" },
);
