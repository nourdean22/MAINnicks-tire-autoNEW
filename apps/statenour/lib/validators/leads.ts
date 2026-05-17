/**
 * Lead validators · v10.0.53 · Wave A · cleanup.
 *
 * `leadUpdateSchema` removed — `updateLead` was deleted from
 * lib/services/leads.ts because lead updates moved to nickstire
 * admin. `leadCreateSchema` is still consumed by createLead in the
 * capture-to-LEAD flow.
 */

import { z } from "zod";

import { leadSourceValues, leadStatusValues, leadTypeValues, leadUrgencyValues } from "@/lib/domain";
import {
  nullableDate,
  nullableInteger,
  nullableString,
  requiredString
} from "@/lib/validators/shared";

export const leadCreateSchema = z.object({
  fullName: requiredString("Lead name"),
  source: z.enum(leadSourceValues).default("OTHER"),
  inquiryText: requiredString("Inquiry text"),
  leadType: z.enum(leadTypeValues).default("OTHER"),
  manualLeadTypeOverride: z.enum(leadTypeValues).nullable().optional(),
  urgency: z.enum(leadUrgencyValues).default("MEDIUM"),
  manualUrgencyOverride: z.enum(leadUrgencyValues).nullable().optional(),
  valueEstimate: nullableInteger(0, 100_000).optional(),
  manualValueEstimateOverride: nullableInteger(0, 100_000).optional(),
  status: z.enum(leadStatusValues).default("NEW"),
  lastContactAt: nullableDate.optional(),
  followUpDueAt: nullableDate.optional(),
  objectionType: nullableString.optional(),
  assignedTo: nullableString.optional(),
  outcome: nullableString.optional(),
  bookingValue: nullableInteger(0, 100_000).optional(),
  timeToResponseMinutes: nullableInteger(0, 100_000).optional()
});
