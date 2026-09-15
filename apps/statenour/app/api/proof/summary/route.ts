/**
 * GET /api/proof/summary — mission-control numbers for /proof: claims by
 * evidence grade, recent events, recent claims, recent taste judgments,
 * recent Night Shift proposals. Owner-only; read-only.
 */
import { apiHandler } from "@/lib/utils/http";
import { proofSummary } from "@/lib/services/reality-ledger";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => proofSummary(), { auth: "owner" });
