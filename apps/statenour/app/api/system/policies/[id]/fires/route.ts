import { apiHandler } from "@/lib/utils/http";
import { listPolicyFiresView } from "@/lib/services/system-pages-b";

/**
 * GET /api/system/policies/[id]/fires — fire history for a specific policy.
 *
 * Owner-only (operator-private governance data).
 *
 * Query params:
 *   ?limit=50 (default)
 *   ?offset=0 (default)
 *
 * v10.0.169 — new endpoint for chronological fire history.
 *
 * Phase B.7b (2026-05-22 · legacy-modernizer REST→tRPC system-pages
 * slice) · delegates to the shared
 * `lib/services/system-pages-b.listPolicyFiresView` service · this
 * route AND the new `trpc.system.policyFires` procedure call the same
 * function · drift impossible. The route stays mounted as the rollback
 * path.
 */
export const GET = apiHandler(async (req, { params }) => {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  // Next.js 15+ · params is a Promise<Record<string, string>>; await it
  // before destructuring (matches the pattern in the sibling
  // /api/system/policies/[id]/route.ts handler).
  const { id: policyId } = await params!;
  if (!policyId || typeof policyId !== "string") {
    return { fires: [], count: 0 };
  }

  return listPolicyFiresView({ policyId, limit, offset });
}, { auth: "owner" });
