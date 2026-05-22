import { apiHandler } from "@/lib/utils/http";
import { z } from "zod";
import { runManifestCron } from "@/lib/services/cron-control";

/**
 * POST /api/system/crons/run · fire a cron now.
 * Body: { jobName: string }
 * Auth: owner-only.
 *
 * Validates against the manifest so an attacker can't invoke arbitrary
 * paths. Kill-switch override: runs even when disabled (explicit manual
 * run takes precedence).
 *
 * Phase B.7a (2026-05-22) · the manifest-validate + trigger logic moved
 * to the shared `cron-control.runManifestCron` service so the legacy
 * REST endpoint AND the new `system.runManifestCron` tRPC procedure
 * can't drift. This route stays mounted as the coexistence / rollback
 * path. ServiceError(404/410) → apiHandler maps to the matching status.
 */

const BodySchema = z.object({
  jobName: z.string().min(1).max(64),
});

export const POST = apiHandler(async (req) => {
  const body = BodySchema.parse(await req.json());
  return runManifestCron(body.jobName);
}, { auth: "owner" });
