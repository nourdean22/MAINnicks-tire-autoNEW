/**
 * Body tracking · daily check-in for weight + composition + sleep +
 * workout + energy + stress + notes.
 *
 * Phase XX (2026-05-19 AM) · heavy lifting moved to
 * `lib/services/body-tracking` so both this REST endpoint AND the
 * new `trpc.operator.{bodyTracking, logBodyEntry}` procedures call
 * the same functions · drift impossible.
 */
import { apiHandler } from "@/lib/utils/http";
import {
  getBodyTracking,
  logBodyEntry,
  bodyEntrySchema,
} from "@/lib/services/body-tracking";

export const GET = apiHandler(async (req) => {
  const { searchParams } = new URL(req.url);
  return getBodyTracking({ range: searchParams.get("range") || "90d" });
}, { auth: "owner" });

export const POST = apiHandler(async (req) => {
  const body = bodyEntrySchema.parse(await req.json());
  return logBodyEntry(body);
}, { auth: "owner" });
