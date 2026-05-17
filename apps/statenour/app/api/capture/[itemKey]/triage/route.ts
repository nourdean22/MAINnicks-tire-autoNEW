import { CaptureConversionTarget, CaptureTriageStatus } from "@prisma/client";

import { triageCaptureItem } from "@/lib/services/capture";
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { captureTriageSchema } from "@/lib/validators/capture";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// v10.0.119 audit-pattern fix · owner-gated.
export const PATCH = apiHandler(async (req, { params }) => {
  const { itemKey } = await params!;
  const payload = captureTriageSchema.parse(await readRequestJson(req));
  return triageCaptureItem(itemKey, {
    triageStatus: payload.triageStatus as CaptureTriageStatus | undefined,
    primaryTag: payload.primaryTag || null,
    actionabilityScore: payload.actionabilityScore ?? null,
    conversionTarget: payload.conversionTarget as CaptureConversionTarget | null | undefined
  });
}, { auth: "owner" });
