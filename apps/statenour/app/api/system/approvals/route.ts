import { apiHandler } from "@/lib/utils/http";
import {
  listPendingActions,
  summarizeQueue,
} from "@/lib/automation/approval-queue";

/**
 * GET /api/system/approvals · v10.0.153
 *
 * Returns every AutonomousAction row where approval = "pending"
 * along with policy hints (objective, declared approval class)
 * folded in so the operator triages quickly.
 *
 * Owner-gated. Read-only. Sister mutating route lives at
 * /api/system/approvals/[id] (POST = decide).
 */
export const GET = apiHandler(
  async () => {
    const [rows, summary] = await Promise.all([
      listPendingActions(),
      summarizeQueue(),
    ]);
    return { summary, rows };
  },
  { auth: "owner" },
);
