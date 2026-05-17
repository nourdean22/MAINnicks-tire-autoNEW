/**
 * GET /api/ai/errors/recent
 *
 * Returns recent ai_error audit events for the NotificationCenter HUD.
 * Used by the error pulse indicator to surface silent failures that
 * were previously invisible behind `.catch(() => {})`.
 *
 * Query params:
 *   window=60   — lookback window in minutes (default 60)
 *   limit=20    — max rows returned (default 20, max 100)
 */

import { getRecentErrors, getRecentErrorCount } from "@/lib/errors/record-error";
import { requireSession } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

// v10.0.44 — auth gate. Internal error log entries leak system state
// (failure modes, stack-trace hints) useful to attackers enumerating
// the surface; must be owner-only.
export async function GET(req: Request) {
  await requireSession(req);
  const url = new URL(req.url);
  const windowMinutes = Math.max(
    5,
    Math.min(24 * 60, Number(url.searchParams.get("window") || "60"))
  );
  const limit = Math.max(
    1,
    Math.min(100, Number(url.searchParams.get("limit") || "20"))
  );

  const [count, errors] = await Promise.all([
    getRecentErrorCount(windowMinutes),
    getRecentErrors(windowMinutes, limit),
  ]);

  return Response.json({
    count,
    windowMinutes,
    errors,
  });
}
