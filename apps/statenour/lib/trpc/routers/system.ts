/**
 * lib/trpc/routers/system.ts · Phase S.2 (2026-05-18 PM) · extended
 * Phase UU.2 (2026-05-22 · legacy-modernizer REST→tRPC settings slice)
 * · extended Phase VV (2026-05-22 · REST→tRPC system-widgets sub-slice).
 *
 * System telemetry procedures · per the J tRPC migration plan, this is
 * the third domain router (after `nick` for reasoning + `operator` for
 * forward-looking state). Lives separately so future /system/* surface
 * migrations have a natural home without ballooning the nick router.
 *
 * Replaces (coexistence · legacy REST stays mounted):
 *   · GET /api/system/health-report → healthReport
 *
 * Phase UU.2 folds the /settings system-ops surfaces in here (rather
 * than spawning a thin `settings` router): cron control catalog +
 * path-trigger, auto-pilot flags, tools health, and the three
 * SystemDataCards endpoints (health-trend · error-rate · quotas). All
 * are config / system-ops flavoured → `system` is their natural home.
 *
 * Phase VV folds the 15 components/system/* dashboard widgets in here
 * (the system domain is genuinely large — one router, no sub-routers):
 *   evalResults · promptCompare · promptShadowTrend · promptLibrary ·
 *   decisionDrift · antiPatterns + createAntiPattern + revisitAntiPattern
 *   + deleteAntiPattern · quality · schemaDrift · errorsGrouped +
 *   errorsRecent · staleData + purgeStaleData · schemaCoverage · gaps ·
 *   embeddingCoverage · cronTree · entityHistory · hub.
 *
 * Every procedure delegates to a shared service so the legacy REST
 * consumers and the new tRPC consumers can't drift.
 */


import { router } from "../trpc";
import { healthProcedures } from "./system/health";
import { cronProcedures } from "./system/cron";
import { autopilotProcedures } from "./system/autopilot";
import { promptsProcedures } from "./system/prompts";
import { qualityProcedures } from "./system/quality";
import { schemaProcedures } from "./system/schema";
import { devicesProcedures } from "./system/devices";
import { agentsProcedures } from "./system/agents";
import { notificationsProcedures } from "./system/notifications";
import { digestProcedures } from "./system/digest";
import { toolsProcedures } from "./system/tools";
import { actionsProcedures } from "./system/actions";
import { inboxProcedures } from "./system/inbox";

/**
 * Mechanical decomposition (2026-05-31): the ~105 procedures were moved
 * VERBATIM into per-domain files under ./system/*. Each domain file
 * exports a plain procedure-object; we recompose with object spread so
 * EVERY client path stays FLAT as `trpc.system.<proc>` — unchanged. No
 * nesting (that would shift paths to `trpc.system.<domain>.<proc>`).
 */
export const systemRouter = router({
  ...healthProcedures,
  ...cronProcedures,
  ...autopilotProcedures,
  ...promptsProcedures,
  ...qualityProcedures,
  ...schemaProcedures,
  ...devicesProcedures,
  ...agentsProcedures,
  ...notificationsProcedures,
  ...digestProcedures,
  ...toolsProcedures,
  ...actionsProcedures,
  ...inboxProcedures,
});
