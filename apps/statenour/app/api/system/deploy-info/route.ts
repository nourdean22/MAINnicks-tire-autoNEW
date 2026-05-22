/**
 * GET /api/system/deploy-info — current deployment identity.
 *
 * // public: build SHA + branch + deploy timestamp are non-sensitive
 * (the same data is in every Vercel deploy URL). Locked down would
 * break the unauthenticated HQ chip that shows "deployed Xh ago".
 *
 * Vercel injects the following build-time env vars on every deploy:
 *   VERCEL_GIT_COMMIT_SHA     — short SHA of the commit that triggered the build
 *   VERCEL_GIT_COMMIT_MESSAGE — first line of the commit message
 *   VERCEL_GIT_COMMIT_REF     — branch name
 *   VERCEL_DEPLOYMENT_ID      — deployment ID (dpl_...)
 *   VERCEL_ENV                — "production" | "preview" | "development"
 *
 * Build time is the best approximation of "deployed at" since Vercel
 * doesn't expose the actual deploy-created timestamp at runtime. We
 * stamp it via BUILD_TIME env that next.config.ts sets.
 *
 * Used by the HQ deployment chip (components/ultron/deploy-chip.tsx)
 * so Nour can see at a glance which SHA is live and how long ago it
 * deployed.
 */

import { NextResponse } from "next/server";
// Phase B.6c · the env-var read moved to a shared service so the
// legacy REST route AND the tRPC `system.deployInfo` procedure call the
// same function · drift impossible.
import { buildDeployInfo } from "@/lib/services/deploy-info";

export async function GET() {
  return NextResponse.json({ data: buildDeployInfo() });
}
