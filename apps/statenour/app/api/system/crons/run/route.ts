import { apiHandler } from "@/lib/utils/http";
import { z } from "zod";
import { triggerCronByPath } from "@/lib/services/cron-control";
import { CRONS } from "@/config/crons";

/**
 * POST /api/system/crons/run · fire a cron now.
 * Body: { jobName: string }
 * Auth: owner-only.
 *
 * Validates against the manifest so an attacker can't invoke arbitrary
 * paths. Kill-switch override: runs even when disabled (explicit manual
 * run takes precedence).
 *
 * v10.0.119 audit-pattern follow-up · the prior comment claimed "Auth:
 * operator session (apiHandler default)" but apiHandler has NO default
 * auth — same foot-gun audit 10 caught on /api/tasks. Anonymous callers
 * could trigger any cron in the manifest. Now actually owner-gated.
 */

const BodySchema = z.object({
  jobName: z.string().min(1).max(64),
});

export const POST = apiHandler(async (req) => {
  const body = BodySchema.parse(await req.json());
  const def = CRONS.find((c) => c.name === body.jobName);
  if (!def) {
    throw Object.assign(new Error(`unknown cron: ${body.jobName}`), { status: 404, code: "CRON_UNKNOWN" });
  }
  if (def.mode === "retired") {
    throw Object.assign(new Error(`cron ${body.jobName} is retired`), { status: 410, code: "CRON_RETIRED" });
  }
  const path = def.path ?? `/api/cron/${body.jobName}`;
  const result = await triggerCronByPath(path);
  return { jobName: body.jobName, ...result };
}, { auth: "owner" });
