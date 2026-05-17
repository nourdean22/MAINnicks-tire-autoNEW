import { timingSafeEqual } from "node:crypto";

import { ServiceError } from "@/lib/utils/service-error";

const RUNNER_SECRET_HEADER = "x-runner-secret";

// v10.0.529.105 · Wave 49 · removed DEV_RUNNER_SECRET = "statenour-
// local-runner" hardcoded fallback. The fallback fired in any env
// where NODE_ENV !== "production" AND RUNNER_SHARED_SECRET was unset.
// Vercel preview deployments default to NODE_ENV="production" but
// custom local previews / staging / e2e environments can have the
// fallback active. The hardcoded string is in the public repo · anyone
// who reads the source can hit all 4 /api/internal/runner/* mutation
// routes via a preview URL. Now requires RUNNER_SHARED_SECRET in every
// environment (including dev).

function compareSecrets(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function assertRunnerRequest(request: Request) {
  const configuredSecret = (process.env.RUNNER_SHARED_SECRET || "").trim();
  const providedSecret = request.headers.get(RUNNER_SECRET_HEADER)?.trim() || "";

  if (!configuredSecret) {
    throw new ServiceError(
      "Runner secret is not configured. Set RUNNER_SHARED_SECRET env var (required in all environments since Wave 49).",
      500,
    );
  }

  if (!providedSecret || !compareSecrets(configuredSecret, providedSecret)) {
    throw new ServiceError("Unauthorized runner request.", 401);
  }
}

export function getRunnerSecretHeader() {
  return RUNNER_SECRET_HEADER;
}
