import { redirect } from "next/navigation";

/**
 * /system/errors -> /system/logs (2026-06-10).
 *
 * The standalone errors page was consolidated into /system/logs (the
 * unified tail with a "grouped errors" view over ErrorLog + CronJobLog
 * + SystemMetric + AutonomousAction + ApiRequestLog). The route was
 * removed but several references survived (the /system hub KPI hint,
 * RUNBOOK error-triage steps, old bookmarks) — all 404'd. This redirect
 * keeps every legacy link working and lands on the live error surface.
 *
 * NOTE: the API route `app/api/system/errors/route.ts` is unrelated and
 * still serves GET/DELETE — only the *page* moved.
 */
export default function SystemErrorsRedirect() {
  redirect("/system/logs");
}
