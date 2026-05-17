/**
 * GET /api/brain/nudges — cross-system real-time deltas.
 * Renders on the /brain page NudgePanel.
 */
import { apiHandler } from "@/lib/utils/http";
import { computeNudges } from "@/lib/brain/cross-system-nudge";

export const GET = apiHandler(
  async () => {
    const nudges = await computeNudges();
    return { nudges };
  },
  { auth: "owner" },
);
