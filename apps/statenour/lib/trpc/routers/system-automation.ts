import { router } from "../trpc";
import { cronProcedures } from "./system/cron";
import { autopilotProcedures } from "./system/autopilot";
import { actionsProcedures } from "./system/actions";

// Extract just the approvals from autopilot and actions
const { approvals, decideApproval } = autopilotProcedures;
const { getPendingApprovals } = actionsProcedures;

export const systemAutomationRouter = router({
  // Crons, cron-runs, cron-diagnostics
  ...cronProcedures,
  
  // Approvals
  approvals,
  decideApproval,
  getPendingApprovals,
});
