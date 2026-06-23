/**
 * GET    /api/settings/crons          — catalog + kill-switch + 14d stats
 * PATCH  /api/settings/crons          — toggle enabled for a named cron
 * POST   /api/settings/crons/trigger  — manual fire a cron (lives in sibling route)
 *
 * Nour-only surface. v10.0.44 — `{ auth: "owner" }` made explicit on
 * both handlers. The header-comment claim that "apiHandler default
 * session guard" applied was wrong: apiHandler defaults to NO auth;
 * the option is opt-in. Pre-fix any caller could read the kill-switch
 * state and toggle crons.
 */
import { apiHandler, jsonOk, readRequestJson } from "@/lib/utils/http";
import {
  listScheduledCrons,
  listCronControls,
  setCronEnabled,
  getCronStats,
} from "@/lib/services/cron-control";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const [scheduled, controls, stats] = await Promise.all([
    listScheduledCrons(),
    listCronControls(),
    getCronStats(),
  ]);

  const controlsMap = new Map(controls.map((c) => [c.jobName, c]));

  // Include mega-cron fanout jobs so Nour can kill them individually
  // even though they don't have their own schedule row.
  const MEGA_FANOUT = [
    "device-sync", "learn", "stale-tasks", "device-health", "brain-cycle",
    "notification-sender", "journal-checkin", "embed-backfill",
    "reflect", "predict", "think", "consolidate", "drift-check",
    "data-cleanup", "intelligence",
  ];
  const scheduledNames = new Set(scheduled.map((c) => c.jobName));
  const virtualCrons = MEGA_FANOUT
    .filter((name) => !scheduledNames.has(name))
    .map((name) => ({
      jobName: name,
      path: `/api/cron/${name}`,
      schedule: "(mega fanout)",
    }));

  const all = [...scheduled, ...virtualCrons];

  const rows = all.map((c) => {
    const control = controlsMap.get(c.jobName);
    const stat = stats[c.jobName] ?? {
      lastSuccessAt: null,
      lastFailAt: null,
      success14d: 0,
      fail14d: 0,
    };
    return {
      ...c,
      enabled: control?.enabled ?? true,
      note: control?.note ?? null,
      controlUpdatedAt: control?.updatedAt ?? null,
      ...stat,
    };
  });

  return rows;
}, { auth: "owner" });

export const PATCH = apiHandler(async (req) => {
  const body = await readRequestJson<{ jobName?: string; enabled?: boolean; note?: string }>(req);
  if (!body.jobName || typeof body.enabled !== "boolean") {
    return jsonOk({ error: "jobName + enabled required" }, { status: 400 });
  }
  const next = await setCronEnabled(body.jobName, body.enabled, body.note);
  return { jobName: body.jobName, enabled: next };
}, { auth: "owner" });
