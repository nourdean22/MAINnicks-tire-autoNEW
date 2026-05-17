/**
 * POST /api/brain/calibrate · v10.0.91 · 2026-05-02.
 *
 * Returns the calibrated confidence for a piece of advice text.
 * Body: { advice: string }
 *
 * Used by the chat tail-renderer to show "this advice is X%
 * calibrated based on your past feedback on N similar replies".
 *
 * Auth: owner only.
 */

import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import {
  calibrateAdvice,
  formatConfidenceTail,
} from "@/lib/ai/calibrated-confidence";

export const POST = apiHandler(
  async (req) => {
    const body = (await req.json()) as { advice?: string };
    const advice = body.advice?.trim();
    if (!advice) throw new ServiceError("advice required", 400);
    const result = await calibrateAdvice(advice);
    return {
      ...result,
      tailLine: formatConfidenceTail(result),
    };
  },
  { auth: "owner" },
);
