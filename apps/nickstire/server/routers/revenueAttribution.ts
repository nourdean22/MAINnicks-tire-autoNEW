import { sql } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  aggregateVerifiedLeadRevenue,
  buildCallInvoiceCandidates,
  type CallObservation,
  type LeadInvoiceRow,
  type LeadLinkObservation,
  type PaidInvoiceObservation,
} from "../services/revenueAttribution";

const dateRangeSchema = z.object({
  sinceISO: z.string().datetime(),
  untilISO: z.string().datetime().optional(),
});

function rowsFromExecute<T