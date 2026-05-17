/**
 * cronJobName() — pure helper for building CronJobLog.jobName strings.
 *
 * Separated from lib/utils/http.ts so unit tests can import it without
 * pulling the full next-auth / prisma / logger stack through vitest.
 *
 * Contract:
 *   Input  · route (pathname), query (URLSearchParams)
 *   Output · short jobName that matches the CRONS manifest entries
 *
 * Strips the `/api/cron/` prefix, then appends the `?slot=X` query
 * param (falling back to `?task=X`) if present so fanned-out mega
 * crons get distinct names — "mega-morning", "mega-afternoon", etc.
 *
 * Regression guard: before 2026-04-22, every mega slot logged as
 * jobName "mega" and the /settings/crons panel (which queries by the
 * manifest name) found no rows → every job showed success14d=0 /
 * fail14d=0. See tests/lib/cron-job-name.test.ts.
 */

export function cronJobName(route: string, query: URLSearchParams): string {
  const base = route.replace(/^\/api\/cron\//, "").replace(/\/.*$/, "");
  const slot = query.get("slot") || query.get("task");
  return slot ? `${base}-${slot}` : base;
}
