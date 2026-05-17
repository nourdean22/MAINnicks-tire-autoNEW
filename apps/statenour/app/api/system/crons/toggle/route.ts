import { apiHandler } from "@/lib/utils/http";
import { z } from "zod";
import { setCronEnabled } from "@/lib/services/cron-control";

/**
 * POST /api/system/crons/toggle · flip a cron's kill switch.
 * Body: { jobName: string, enabled: boolean, note?: string }
 * Auth: owner-only.
 *
 * v10.0.119 audit-pattern follow-up · same default-auth foot-gun as
 * crons/run. Anonymous callers could disable safety crons (cost-anomaly,
 * bus-exhaustion-watch, etc.). Now actually owner-gated.
 */

const BodySchema = z.object({
  jobName: z.string().min(1).max(64),
  enabled: z.boolean(),
  note: z.string().max(280).optional(),
});

export const POST = apiHandler(async (req) => {
  const body = BodySchema.parse(await req.json());
  const enabled = await setCronEnabled(body.jobName, body.enabled, body.note);
  return { jobName: body.jobName, enabled };
}, { auth: "owner" });
