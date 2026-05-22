/**
 * GET /api/brain/export — full self-model dump as JSON.
 *
 * Everything the brain learning stack has stored about Nour, ready
 * to download. Useful for backups, manual audit, or piping into
 * another tool.
 *
 * Phase B.6d (2026-05-22 · legacy-modernizer REST→tRPC brain slice) ·
 * the inline assembly moved to `lib/services/brain-domain.buildBrainExport`
 * so this route AND the new `trpc.brain.exportBrain` procedure call the
 * same function · drift impossible.
 */
import { apiHandler } from "@/lib/utils/http";
import { buildBrainExport } from "@/lib/services/brain-domain";

export const GET = apiHandler(
  async () => {
    return buildBrainExport();
  },
  { auth: "owner" },
);
