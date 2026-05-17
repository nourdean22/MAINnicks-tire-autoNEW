import { CaptureConversionTarget, MissionDomain } from "@prisma/client";

import { convertCaptureItem } from "@/lib/services/capture";
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { captureConvertSchema } from "@/lib/validators/capture";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// v10.0.119 audit-pattern fix · was unauthenticated. Mutates capture
// → mission/task with attacker-controlled domain + urgency. Owner
// gate.
export const POST = apiHandler(async (req, { params }) => {
  const { itemKey } = await params!;
  const payload = captureConvertSchema.parse(await readRequestJson(req));
  return convertCaptureItem(itemKey, {
    target: payload.target as CaptureConversionTarget,
    missionId: payload.missionId,
    domain: payload.domain as MissionDomain | undefined,
    successMetric: payload.successMetric || null,
    urgency: payload.urgency,
    valueEstimate: payload.valueEstimate ?? null,
    note: payload.note || null
  });
}, { auth: "owner" });
