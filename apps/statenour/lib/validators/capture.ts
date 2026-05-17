import { z } from "zod";

import {
  captureConversionTargetValues,
  captureTriageStatusValues,
  leadUrgencyValues,
  missionDomainValues
} from "@/lib/domain";
import { nullableInteger, nullableString, optionalString } from "@/lib/validators/shared";

export const captureTriageSchema = z.object({
  triageStatus: z.enum(captureTriageStatusValues).optional(),
  primaryTag: nullableString.optional(),
  actionabilityScore: nullableInteger(0, 100).optional(),
  conversionTarget: z.enum(captureConversionTargetValues).nullable().optional()
});

export const captureConvertSchema = z.object({
  target: z.enum(captureConversionTargetValues),
  missionId: optionalString,
  domain: z.enum(missionDomainValues).optional(),
  successMetric: nullableString.optional(),
  urgency: z.enum(leadUrgencyValues).optional(),
  valueEstimate: nullableInteger(0, 100_000).optional(),
  note: nullableString.optional()
});
