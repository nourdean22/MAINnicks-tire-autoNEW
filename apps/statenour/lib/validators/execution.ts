import { z } from "zod";

import {
  commandResolutionTypeValues,
  communicationModeValues,
  dayStateValues,
  empireLaneValues
} from "@/lib/domain";
import { booleanFlag, integerRange, nullableString, optionalString, requiredString } from "@/lib/validators/shared";

export const operatorCheckInSchema = z.object({
  energyScore: integerRange(1, 10),
  focusScore: integerRange(1, 10),
  driftPressure: integerRange(0, 10),
  operatingMode: z.enum(communicationModeValues).default("DIRECT"),
  empireLane: z.enum(empireLaneValues).default("MONEY"),
  notes: nullableString.optional()
});

export const commandResolveSchema = z.object({
  resolutionType: z.enum(commandResolutionTypeValues),
  note: nullableString.optional(),
  deferReason: nullableString.optional(),
  blockedReason: nullableString.optional(),
  replaceReason: nullableString.optional(),
  replacementCommand: nullableString.optional(),
  recoveryTouch: booleanFlag.optional().default(false)
});

export const dayResetSchema = z.object({
  empireLane: z.enum(empireLaneValues).optional(),
  shadowMode: booleanFlag.optional(),
  recoveryQuota: integerRange(0, 50).optional(),
  currentCommand: optionalString,
  activeMissionId: optionalString
});

export const dayShutdownSchema = z.object({
  missionMoved: booleanFlag.default(false),
  tomorrowFirstMove: requiredString("Tomorrow's first move"),
  notes: nullableString.optional(),
  dayState: z.enum(dayStateValues).default("CLOSED")
});
