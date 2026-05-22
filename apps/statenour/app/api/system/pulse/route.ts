import { apiHandler } from "@/lib/utils/http";
import { buildSystemPulse } from "@/lib/services/system-pulse";

/**
 * GET /api/system/pulse — the tiny rollup that powers the FloatingHome
 * nav badges + any other "is the system OK?" widget.
 *
 * hooks-lib REST→tRPC slice (2026-05-22) · the pulse assembly (the
 * 6-query fan-out + cron-drift detection + Nick-quality trend + the
 * 30s cache) moved verbatim to `lib/services/system-pulse.buildSystem
 * Pulse` so the legacy REST consumer AND the new `system.pulse` tRPC
 * procedure can't drift. This route stays mounted as the coexistence /
 * rollback path. `useSystemPulse` now reads tRPC; this endpoint
 * survives for any non-tRPC caller.
 */
export const GET = apiHandler(async () => buildSystemPulse(), {
  auth: "owner",
});
