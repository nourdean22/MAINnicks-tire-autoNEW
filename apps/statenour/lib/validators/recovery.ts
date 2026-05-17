import { z } from "zod";

import { nullableDate, nullableInteger, nullableString } from "@/lib/validators/shared";

export const recoveryUpdateSchema = z.object({
  status: z.enum(["open", "called", "voicemail", "follow_up", "booked", "done", "dead", "not_interested"]),
  note: nullableString.optional(),
  callbackNote: nullableString.optional(),
  nextFollowUpAt: nullableDate.optional(),
  outcome: nullableString.optional(),
  expectedValue: nullableInteger(0, 100_000).optional()
});
