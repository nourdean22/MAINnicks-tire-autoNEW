import { z } from "zod";

import { communicationModeValues, designModeValues, devicePriorityValues } from "@/lib/domain";
import { nullableString, requiredString } from "@/lib/validators/shared";

const listField = z.preprocess(
  (value) => {
    if (value == null || value === "") {
      return [];
    }
    if (Array.isArray(value)) {
      return value;
    }
    if (typeof value === "string") {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  },
  z.array(z.string().trim().min(1)).max(12)
);

export const operatorProfileUpdateSchema = z.object({
  preferredName: requiredString("Preferred name"),
  communicationMode: z.enum(communicationModeValues),
  devicePriority: z.enum(devicePriorityValues),
  designMode: z.enum(designModeValues),
  systemObjective: nullableString.optional(),
  preferredPressureStyle: nullableString.optional(),
  antiPatterns: listField,
  primaryAmbitions: listField
});

export const operatorPreferencesUpdateSchema = z.object({
  uiDensity: z.string().trim().min(1).max(24),
  motionLevel: z.string().trim().min(1).max(24),
  alertAggressiveness: z.string().trim().min(1).max(24),
  voiceToneBoundaries: z
    .record(z.string(), z.union([z.string(), z.boolean(), z.number()]))
    .optional()
});
