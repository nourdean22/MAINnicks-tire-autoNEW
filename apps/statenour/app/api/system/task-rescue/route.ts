/**
 * GET /api/system/task-rescue · F3 task/mission rescue scanner.
 *
 * Owner-only, READ-ONLY. Returns tasks that are unfiled/misfiled/stale/
 * low-confidence with a reason + confidence + suggested fix. Never moves
 * anything; the operator confirms fixes elsewhere. GENERAL anchors are protected.
 */

import { apiHandler } from "@/lib/utils/http";
import { buildTaskRescue } from "@/lib/services/task-rescue";

export const GET = apiHandler(async () => buildTaskRescue(), { auth: "owner" });
