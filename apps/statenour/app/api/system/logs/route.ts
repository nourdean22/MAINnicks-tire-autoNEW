import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

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
 */

export type LogLevel = "error" | "warn" | "info" | "success" | "metric";

export interface LogEntry {
  id: string;
  ts: string;
  source: "errors" | "crons" | "metrics" | "actions" | "requests";
  level: LogLevel;
  label: string;
  detail: string | null;
  meta?: Record<string, unknown>;
}

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const limit = Math.min(500, Math.max(10, Number(url.searchParams.get("limit")) || 200));
  const sinceMs = Math.min(86400_000, Math.max(60_000, Number(url.searchParams.get("since")) || 3600_000));
  const since = new Date(Date.now() - sinceMs);
  const levelFilter = url.searchParams.get("level") as LogLevel | null;
  const sourceFilter = (url.searchParams.get("source")?.split(",").filter(Boolean) ?? []) as LogEntry["source"][];

  const wants = (s: LogEntry["source"]) => sourceFilter.length === 0 || sourceFilter.includes(s);
  const perSource = Math.max(20, Math.ceil(limit / Math.max(1, sourceFilter.length || 5)));

  const [errors, crons, metrics, actions, requests] = await Promise.all([
    wants("errors")
      ? prisma.errorLog.findMany({
          where: { createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
          take: perSource,
        })
      : [],
    wants("crons")
      ? prisma.cronJobLog.findMany({
          where: { createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
          take: perSource,
        })
      : [],
    wants("metrics")
      ? prisma.systemMetric.findMany({
          where: { createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
          take: perSource,
        })
      : [],
    wants("actions")
      ? prisma.autonomousAction.findMany({
          where: { createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
          take: perSource,
        })
      : [],
    // v11 cleanup · include 4xx/5xx errors AND slow-normal requests
    // (durationMs > 3000ms). A slow-200 bug is invisible in a
    // failures-only feed.
    wants("requests")
      ? prisma.apiRequestLog.findMany({
          where: {
            createdAt: { gte: since },
            OR: [{ statusCode: { gte: 400 } }, { durationMs: { gte: 3000 } }],
          },
          orderBy: { createdAt: "desc" },
          take: perSource,
        })
      : [],
  ]);

  const entries: LogEntry[] = [];

  for (const r of errors as Array<{ id: string; createdAt: Date; level: string; message: string; stack: string | null; context: unknown }>) {
    entries.push({
      id: `err:${r.id}`,
      ts: r.createdAt.toISOString(),
      source: "errors",
      level: (r.level === "fatal" || r.level === "error" ? "error" : r.level === "warn" ? "warn" : "info"),
      label: r.message.slice(0, 140),
      detail: r.stack?.slice(0, 300) ?? null,
      meta: { fullMessage: r.message, context: r.context },
    });
  }

  for (const r of crons as Array<{ id: string; createdAt: Date; jobName: string; status: string; duration: number | null; error: string | null }>) {
    entries.push({
      id: `cron:${r.id}`,
      ts: r.createdAt.toISOString(),
      source: "crons",
      level: r.status === "failed" ? "error" : "success",
      label: `${r.jobName} · ${r.status}${r.duration != null ? ` · ${r.duration}ms` : ""}`,
      detail: r.error,
      meta: { jobName: r.jobName, status: r.status, durationMs: r.duration },
    });
  }

  for (const r of metrics as Array<{ id: string; createdAt: Date; metric: string; value: number; unit: string; tags: unknown; source: string }>) {
    entries.push({
      id: `met:${r.id}`,
      ts: r.createdAt.toISOString(),
      source: "metrics",
      level: "metric",
      label: `${r.metric} = ${r.value}${r.unit || ""} [${r.source}]`,
      detail: null,
      meta: { tags: r.tags, source: r.source, unit: r.unit },
    });
  }

  for (const r of actions as Array<{ id: string; createdAt: Date; ruleName: string; actionType: string; result: string | null; error: string | null; approval: string }>) {
    const failed = r.result === "failed";
    entries.push({
      id: `act:${r.id}`,
      ts: r.createdAt.toISOString(),
      source: "actions",
      level: failed ? "error" : r.approval === "pending" ? "warn" : "success",
      label: `${r.ruleName} · ${r.actionType} · ${r.result ?? "—"}`,
      detail: r.error,
      meta: { ruleName: r.ruleName, approval: r.approval, result: r.result },
    });
  }

  for (const r of requests as Array<{ id: string; createdAt: Date; method: string; path: string; statusCode: number; durationMs: number | null; error: string | null }>) {
    // Classify: 5xx → error, 4xx → warn, slow-normal (durationMs >= 3000) → warn
    const isError = r.statusCode >= 500;
    const isSlow = (r.durationMs ?? 0) >= 3000;
    const level: LogLevel = isError ? "error" : (r.statusCode >= 400 || isSlow) ? "warn" : "info";
    entries.push({
      id: `req:${r.id}`,
      ts: r.createdAt.toISOString(),
      source: "requests",
      level,
      label: `${r.method} ${r.path} · ${r.statusCode}${r.durationMs ? ` · ${r.durationMs}ms${isSlow ? " ⚠ slow" : ""}` : ""}`,
      detail: r.error,
      meta: { method: r.method, path: r.path, statusCode: r.statusCode, durationMs: r.durationMs },
    });
  }

  // Level filter
  let filtered = entries;
  if (levelFilter) {
    filtered = filtered.filter((e) => e.level === levelFilter);
  }

  // Sort newest first + cap at limit
  filtered.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  filtered = filtered.slice(0, limit);

  // Summary
  const summary = {
    total: filtered.length,
    byLevel: filtered.reduce<Record<string, number>>((acc, e) => {
      acc[e.level] = (acc[e.level] ?? 0) + 1;
      return acc;
    }, {}),
    bySource: filtered.reduce<Record<string, number>>((acc, e) => {
      acc[e.source] = (acc[e.source] ?? 0) + 1;
      return acc;
    }, {}),
    sinceMs,
  };

  return {
    entries: filtered,
    summary,
    generatedAt: new Date().toISOString(),
  };
}, { auth: "owner" }); // v9.1.14 · was exposing unified log tail (errors, cron logs, api requests)
