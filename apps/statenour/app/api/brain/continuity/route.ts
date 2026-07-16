/**
 * GET /api/brain/continuity
 *
 * Cross-session memory continuity — what Nick remembered, what
 * decayed, what got reinforced, what's brand-new. One snapshot the
 * /brain/continuity page renders. Owner-auth.
 *
 * Thin legacy-REST wrapper: the entire rollup lives in
 * buildContinuityReport() (lib/services/brain-continuity.ts), shared
 * with the `brain.continuityReport` tRPC procedure. This file used to
 * carry a copy-pasted duplicate of that query block — which drifted
 * (the service gained `deletedAt` filters the copy never did).
 * Delegation makes the drift structurally impossible. The service
 * ISO-stringifies Date fields, which is exactly what JSON
 * serialization did to the old handler's raw rows — the wire shape is
 * unchanged.
 */
import { apiHandler } from "@/lib/utils/http";
import { buildContinuityReport } from "@/lib/services/brain-continuity";

export const GET = apiHandler(async () => buildContinuityReport(), {
  auth: "owner",
});
