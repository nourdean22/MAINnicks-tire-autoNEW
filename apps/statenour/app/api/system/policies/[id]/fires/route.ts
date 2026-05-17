import { apiHandler } from "@/lib/utils/http";
import { getPolicyFireHistory } from "@/lib/automation/policy";

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

  const fires = await getPolicyFireHistory(policyId, { limit, offset });

  return {
    fires,
    count: fires.length,
  };
}, { auth: "owner" });