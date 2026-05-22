/**
 * lib/services/diagnose-chat.ts · hooks-lib REST→tRPC slice (2026-05-22)
 *
 * The "Diagnose with Nick" health probe · extracted verbatim from the
 * GET /api/ai/diagnose-chat route handler so the legacy REST endpoint
 * AND the new `system.diagnoseChat` tRPC procedure both call this one
 * function · drift between the two consumers is structurally
 * impossible.
 *
 * The probe runs synchronous health checks (Venice reachability · Neon
 * latency) + reads recent chat errors / slow requests / ai_error audit
 * events, then assembles a markdown report. It deliberately does NOT
 * touch streamText / compression / brain-context — the whole point is
 * to diagnose a broken chat route WITHOUT going through it.
 *
 * The return shape is the explicit flat `DiagnoseChatResult` (every
 * Date stringified) — no Prisma row reaches the AppRouter (TS2589
 * firewall).
 */

import { prisma } from "@/lib/prisma";

export interface DiagnoseHealthCheck {
  name: string;
  ok: boolean;
  detail: string;
  latencyMs?: number;
}

export interface DiagnoseChatResult {
  ok: boolean;
  status: "healthy" | "degraded";
  checks: DiagnoseHealthCheck[];
  recentErrors: Array<{
    at: string;
    status: number;
    durationMs: number | null;
    error: string | null;
  }>;
  slowRequests: Array<{
    at: string;
    durationMs: number | null;
    status: number;
  }>;
  aiErrorEvents: Array<{
    at: string;
    actor: string;
    detail: string | null;
  }>;
  /** Markdown report — the chat error-card renders this inline. */
  report: string;
}

async function checkVenice(): Promise<DiagnoseHealthCheck> {
  const apiKey = (process.env.VENICE_API_KEY || "").trim();
  if (!apiKey) {
    return { name: "Venice API key", ok: false, detail: "VENICE_API_KEY env var not set" };
  }
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch("https://api.venice.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      return {
        name: "Venice API",
        ok: false,
        detail: `HTTP ${res.status} ${res.statusText}`,
        latencyMs,
      };
    }
    return {
      name: "Venice API",
      ok: latencyMs < 2000,
      detail: latencyMs < 2000 ? "responsive" : `slow (${latencyMs}ms) — streams may time out`,
      latencyMs,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      name: "Venice API",
      ok: false,
      detail: err instanceof Error
        ? err.name === "AbortError" ? "timeout after 3s" : err.message
        : "unknown error",
      latencyMs: Date.now() - t0,
    };
  }
}

async function checkDatabase(): Promise<DiagnoseHealthCheck> {
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - t0;
    return {
      name: "Database (Neon)",
      ok: latencyMs < 1000,
      detail: latencyMs < 1000 ? "responsive" : `slow (${latencyMs}ms)`,
      latencyMs,
    };
  } catch (err) {
    return {
      name: "Database (Neon)",
      ok: false,
      detail: err instanceof Error ? err.message.slice(0, 100) : "query failed",
      latencyMs: Date.now() - t0,
    };
  }
}

/**
 * Run the full chat-route diagnostic. Pings Venice + Neon, reads the
 * last hour of chat errors / slow requests / ai_error audit events,
 * and assembles a markdown report. Owner-only at both transports.
 */
export async function runChatDiagnostic(): Promise<DiagnoseChatResult> {
  const since = new Date(Date.now() - 60 * 60_000); // 1h

  const [veniceCheck, dbCheck, recentErrors, slowLogs, aiErrorEvents] = await Promise.all([
    checkVenice(),
    checkDatabase(),
    prisma.apiRequestLog
      .findMany({
        where: {
          path: { startsWith: "/api/ai/chat" },
          createdAt: { gte: since },
          statusCode: { gte: 400 },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { createdAt: true, statusCode: true, durationMs: true, error: true },
      })
      .catch(() => []),
    prisma.apiRequestLog
      .findMany({
        where: {
          path: { startsWith: "/api/ai/chat" },
          createdAt: { gte: since },
          durationMs: { gte: 15_000 },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { createdAt: true, statusCode: true, durationMs: true },
      })
      .catch(() => []),
    prisma.auditEvent
      .findMany({
        where: { eventType: "ai_error", createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { createdAt: true, actor: true, detail: true },
      })
      .catch(() => []),
  ]);

  const checks: DiagnoseHealthCheck[] = [veniceCheck, dbCheck];
  const allOk = checks.every((c) => c.ok);

  const lines: string[] = [];
  lines.push(`# Chat diagnostic — ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Health checks");
  for (const c of checks) {
    lines.push(
      `- ${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}${c.latencyMs != null ? ` (${c.latencyMs}ms)` : ""}`,
    );
  }
  lines.push("");

  if (recentErrors.length > 0) {
    lines.push(`## Chat errors (${recentErrors.length} in last hour)`);
    for (const e of recentErrors) {
      lines.push(
        `- ${new Date(e.createdAt).toLocaleTimeString()} · ${e.statusCode} · ${e.durationMs}ms${e.error ? ` · ${e.error.slice(0, 80)}` : ""}`,
      );
    }
    lines.push("");
  } else {
    lines.push("## Chat errors");
    lines.push("- none in the last hour at the server level");
    lines.push("");
  }

  if (slowLogs.length > 0) {
    lines.push(`## Slow chat requests (>15s) — ${slowLogs.length}`);
    for (const s of slowLogs) {
      lines.push(`- ${new Date(s.createdAt).toLocaleTimeString()} · ${s.durationMs}ms · status ${s.statusCode}`);
    }
    lines.push("");
  }

  if (aiErrorEvents.length > 0) {
    lines.push(`## ai_error audit events (${aiErrorEvents.length})`);
    for (const e of aiErrorEvents) {
      lines.push(`- ${new Date(e.createdAt).toLocaleTimeString()} · ${e.actor} · ${(e.detail ?? "").slice(0, 100)}`);
    }
    lines.push("");
  }

  lines.push("## What to do next");
  if (!veniceCheck.ok) {
    lines.push("- Venice API is unreachable / slow. Open /settings and flip the Provider pill to OpenAI as a manual fallback.");
    lines.push("- Check https://status.venice.ai for ongoing incidents.");
  }
  if (!dbCheck.ok) {
    lines.push("- Database is unresponsive. This blocks conversation save + brain context. Check Neon status.");
  }
  if (slowLogs.length >= 2) {
    lines.push("- Multiple slow chat requests (>15s). Turn on 'quick' mode on the chat control bar to skip context memory.");
  }
  if (recentErrors.length === 0 && allOk) {
    lines.push("- All checks pass. The stream drop was likely a transient network blip. Tap Retry.");
    lines.push("- If it keeps happening, try forcing the Provider pill to OpenAI temporarily.");
  }
  lines.push("");

  lines.push(
    `**Overall: ${allOk ? "HEALTHY · tap Retry" : "DEGRADED · see recommendations above"}**`,
  );

  return {
    ok: allOk,
    status: allOk ? "healthy" : "degraded",
    checks,
    recentErrors: recentErrors.map((e) => ({
      at: e.createdAt.toISOString(),
      status: e.statusCode,
      durationMs: e.durationMs,
      error: e.error,
    })),
    slowRequests: slowLogs.map((s) => ({
      at: s.createdAt.toISOString(),
      durationMs: s.durationMs,
      status: s.statusCode,
    })),
    aiErrorEvents: aiErrorEvents.map((e) => ({
      at: e.createdAt.toISOString(),
      actor: e.actor,
      detail: e.detail,
    })),
    report: lines.join("\n"),
  };
}
