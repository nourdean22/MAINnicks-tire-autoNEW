/**
 * GET /api/system/observability · v10.0.377
 *
 * Returns the request-tracer report · per-route p50/p95/p99 latency,
 * error rate, top slow routes, top error-prone routes, recent errors.
 *
 * Auth · session required (operator-only).
 * Cache · none · always fresh in-memory snapshot.
 *
 * v10.0.529.106 · Wave 79 · migrated to apiHandler. Only test-only
 * smoke consumer · returning unwrapped data lets the envelope wrap
 * cleanly.
 */

import { apiHandler } from "@/lib/utils/http";
import { buildReport } from "@/lib/observability/tracer";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async () => buildReport(),
  { auth: "owner" },
);
