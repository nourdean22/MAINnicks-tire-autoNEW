/**
 * GET /api/brain/maturity — aggregate brain-maturity score + counters.
 *
 * Rolls up every subsystem into one summary payload. 0-100 score is
 * computed heuristically: more signal = higher maturity.
 *
 * Phase B.6d (2026-05-22 · legacy-modernizer REST→tRPC brain slice) ·
 * the inline rollup moved to `lib/services/brain-domain.buildBrainMaturity`
 * so this route AND the new `trpc.brain.maturity` procedure call the
 * same function · drift impossible. The route keeps the `{ maturity }`
 * envelope; the service returns the rollup unwrapped.
 */
import { apiHandler } from "@/lib/utils/http";
import { buildBrainMaturity } from "@/lib/services/brain-domain";

export const GET = apiHandler(
  async () => {
    return { maturity: await buildBrainMaturity() };
  },
  { auth: "owner" },
);
