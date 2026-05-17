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

const BUILD_TIME =
  process.env.BUILD_TIME || // set via next.config.ts
  process.env.VERCEL_DEPLOYMENT_CREATED_AT || // Vercel runtime var (when present)
  null;

export async function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? "dev";
  const commitMessage = process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null;
  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? "local";
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID ?? null;
  const env = process.env.VERCEL_ENV ?? "development";

  return NextResponse.json({
    data: {
      sha,
      shaShort: sha.slice(0, 7),
      commitMessage: commitMessage ? commitMessage.slice(0, 140) : null,
      branch,
      deploymentId,
      env,
      buildTime: BUILD_TIME,
      // Current server time — client can compute "deployed Xh ago".
      serverTime: new Date().toISOString(),
    },
  });
}
