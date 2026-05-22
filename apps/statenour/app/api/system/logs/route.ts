import { apiHandler } from "@/lib/utils/http";
import { buildSystemLogs } from "@/lib/services/system-pages-b";

/**
 * GET /api/system/logs — unified live tail across every log-shape model.
 *
 * Merges ErrorLog + CronJobLog + ApiRequestLog + SystemMetric +
 * AutonomousAction rows into a single reverse-chron stream. Powers
 * /system/logs — the "what happened in the last hour" feed.
 *
 * Query:
 *   ?limit=200              (default 200, max 500)
 *   ?since=<ms-ago>         (default 3600000 — last hour)
 *   ?level=error|warn|info  (default all)
 *   ?source=errors,crons,metrics,actions,requests  (default all)
 *
 * Phase B.7b (2026-05-22 · legacy-modernizer REST→tRPC system-pages
 * slice) · the 5-table merge + classify + summary logic moved to the
 * shared `lib/services/system-pages-b.buildSystemLogs` service · this
 * route AND the new `trpc.system.systemLogs` procedure call the same
 * function · drift impossible. The route stays mounted as the rollback
 * path.
 */

export type LogLevel = "error" | "warn" | "info" | "success" | "metric";

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit")) || 200;
  const sinceMs = Number(url.searchParams.get("since")) || 3600_000;
  const levelRaw = url.searchParams.get("level");
  const level: LogLevel | undefined =
    levelRaw === "error" ||
    levelRaw === "warn" ||
    levelRaw === "info" ||
    levelRaw === "success" ||
    levelRaw === "metric"
      ? levelRaw
      : undefined;
  const VALID_SOURCES = [
    "errors",
    "crons",
    "metrics",
    "actions",
    "requests",
  ] as const;
  type LogSource = (typeof VALID_SOURCES)[number];
  const sources = (url.searchParams.get("source")?.split(",") ?? [])
    .map((s) => s.trim())
    .filter((s): s is LogSource =>
      (VALID_SOURCES as readonly string[]).includes(s),
    );

  return buildSystemLogs({ limit, sinceMs, level, sources });
}, { auth: "owner" }); // v9.1.14 · was exposing unified log tail (errors, cron logs, api requests)
