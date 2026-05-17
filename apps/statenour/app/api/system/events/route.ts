/**
 * GET /api/system/events — unified system event feed.
 *
 * Reads from FOUR existing event tables — no new schema, no invasive
 * emit-site rewrites. The tables already capture the interesting
 * moments; this endpoint just unions them into a single stream:
 *
 *   · cron_job_logs   → kind="cron"       (every cron fire)
 *   · error_logs      → kind="error"      (runtime/client errors)
 *   · ai_generations  → kind="ai"         (AI calls)
 *   · AuditEvent      → kind="audit"      (brain insights + system events)
 *
 * Client polls with ?since=<iso> to get only new rows — turns a boring
 * log viewer into a live feed when combined with a 3-5s polling loop.
 *
 * ?limit clamped to [1, 200]. Default 50.
 * ?kind filters by source table — one of cron|error|ai|audit|all.
 *
 * Ordered by createdAt DESC (newest first) so the UI can prepend to
 * the top of the list.
 *
 * v10.0.529.106 · Wave 79 · migrated to apiHandler. No external UI
 * consumers found · returning unwrapped data lets the envelope wrap
 * cleanly (was previously returning {data:{...}} so total shape is
 * unchanged once envelope is applied).
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { safeQuery } from "@/lib/db/safe-prisma";

export type EventKind = "cron" | "error" | "ai" | "audit";
export type EventSeverity = "info" | "success" | "warning" | "critical";

export interface SystemEvent {
  id: string;
  kind: EventKind;
  severity: EventSeverity;
  title: string;
  detail: string | null;
  createdAt: string;
  /** Deep-link into the subsurface that owns this event type. */
  href?: string;
}

function severityForCron(status: string): EventSeverity {
  return status === "failed" ? "critical" : "success";
}

function severityForError(level: string): EventSeverity {
  if (level === "fatal") return "critical";
  if (level === "error") return "warning";
  return "info";
}

function severityForAudit(eventType: string): EventSeverity {
  if (eventType.includes("error") || eventType.includes("fail"))
    return "critical";
  if (eventType.includes("warn") || eventType.includes("stale"))
    return "warning";
  if (eventType.includes("complete") || eventType.includes("success"))
    return "success";
  return "info";
}

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const sinceRaw = url.searchParams.get("since");
    const since = sinceRaw ? new Date(sinceRaw) : new Date(Date.now() - 3_600_000);
    const limit = Math.min(
      200,
      Math.max(1, Number(url.searchParams.get("limit") ?? "50")),
    );
    const kindFilter = url.searchParams.get("kind") ?? "all";

    const wantCron = kindFilter === "all" || kindFilter === "cron";
    const wantError = kindFilter === "all" || kindFilter === "error";
    const wantAi = kindFilter === "all" || kindFilter === "ai";
    const wantAudit = kindFilter === "all" || kindFilter === "audit";

    const [cronRows, errorRows, aiRows, auditRows] = await Promise.all([
      wantCron
        ? safeQuery(
            () =>
              prisma.cronJobLog.findMany({
                where: { createdAt: { gt: since } },
                orderBy: { createdAt: "desc" },
                take: limit,
                select: {
                  id: true,
                  jobName: true,
                  status: true,
                  duration: true,
                  error: true,
                  createdAt: true,
                },
              }),
            [],
            { label: "events.cron" },
          )
        : Promise.resolve([]),

      wantError
        ? safeQuery(
            () =>
              prisma.errorLog.findMany({
                where: { createdAt: { gt: since } },
                orderBy: { createdAt: "desc" },
                take: limit,
                select: {
                  id: true,
                  level: true,
                  message: true,
                  createdAt: true,
                },
              }),
            [],
            { label: "events.error" },
          )
        : Promise.resolve([]),

      wantAi
        ? safeQuery(
            () =>
              prisma.aiGeneration.findMany({
                where: { createdAt: { gt: since } },
                orderBy: { createdAt: "desc" },
                take: limit,
                select: {
                  id: true,
                  feature: true,
                  model: true,
                  status: true,
                  durationMs: true,
                  costCents: true,
                  createdAt: true,
                },
              }),
            [],
            { label: "events.ai" },
          )
        : Promise.resolve([]),

      wantAudit
        ? safeQuery(
            () =>
              prisma.auditEvent.findMany({
                where: { createdAt: { gt: since } },
                orderBy: { createdAt: "desc" },
                take: limit,
                select: {
                  id: true,
                  actor: true,
                  eventType: true,
                  detail: true,
                  createdAt: true,
                },
              }),
            [],
            { label: "events.audit" },
          )
        : Promise.resolve([]),
    ]);

    const events: SystemEvent[] = [];

    for (const r of cronRows) {
      events.push({
        id: `cron:${r.id}`,
        kind: "cron",
        severity: severityForCron(r.status),
        title: `${r.jobName} · ${r.status}`,
        detail: r.duration ? `${r.duration}ms${r.error ? ` · ${r.error.slice(0, 120)}` : ""}` : r.error,
        createdAt: r.createdAt.toISOString(),
        href: "/system/cron-diagnostics",
      });
    }

    for (const r of errorRows) {
      events.push({
        id: `error:${r.id}`,
        kind: "error",
        severity: severityForError(r.level),
        title: `${r.level}: ${r.message.slice(0, 100)}`,
        detail: null,
        createdAt: r.createdAt.toISOString(),
        href: `/system/errors?message=${encodeURIComponent(r.message.slice(0, 60))}`,
      });
    }

    for (const r of aiRows) {
      events.push({
        id: `ai:${r.id}`,
        kind: "ai",
        severity: r.status === "failed" ? "critical" : "info",
        title: `${r.feature} · ${r.model}`,
        detail: [
          r.durationMs ? `${r.durationMs}ms` : null,
          r.costCents != null ? `${(r.costCents / 100).toFixed(3)}¢` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        createdAt: r.createdAt.toISOString(),
        href: "/system/ai-cost",
      });
    }

    for (const r of auditRows) {
      events.push({
        id: `audit:${r.id}`,
        kind: "audit",
        severity: severityForAudit(r.eventType),
        title: `${r.actor} · ${r.eventType}`,
        detail: r.detail.slice(0, 160),
        createdAt: r.createdAt.toISOString(),
      });
    }

    events.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
    const trimmed = events.slice(0, limit);

    return {
      events: trimmed,
      count: trimmed.length,
      latestAt: trimmed[0]?.createdAt ?? null,
      queriedSince: since.toISOString(),
    };
  },
  { auth: "owner" },
);
