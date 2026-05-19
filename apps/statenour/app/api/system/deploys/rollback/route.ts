/**
 * POST /api/system/deploys/rollback
 *
 * Rolls production back to the previous READY deploy via the Vercel
 * v9 promote endpoint. Owner-auth.
 *
 * Phase KK (2026-05-18 PM) · heavy lifting moved to
 * `lib/services/deploys.rollbackProductionDeploy` so both this REST
 * endpoint AND the new `trpc.system.rollbackDeploy` mutation call the
 * same function · drift impossible. Stays mounted for back-compat.
 *
 * Returns:
 *   · 200 + RollbackResult on success
 *   · 501 when VERCEL_TOKEN env unset (Builder UI treats as graceful)
 *   · 409 when fewer than 2 READY deploys exist
 *   · 502 on Vercel API failures
 */
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import {
  rollbackProductionDeploy,
  VercelTokenMissingError,
  NoPreviousDeployError,
} from "@/lib/services/deploys";

export const POST = apiHandler(
  async () => {
    try {
      return await rollbackProductionDeploy();
    } catch (err) {
      if (err instanceof VercelTokenMissingError) {
        throw new ServiceError(err.message, 501);
      }
      if (err instanceof NoPreviousDeployError) {
        throw new ServiceError(err.message, 409);
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new ServiceError(msg, 502);
    }
  },
  { auth: "owner" },
);
