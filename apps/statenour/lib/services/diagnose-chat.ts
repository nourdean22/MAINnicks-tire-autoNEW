/**
 * lib/services/diagnose-chat.ts · hooks-lib REST→tRPC slice (2026-05-22)
 *
 * The "Diagnose with Nick" health probe · extracted verbatim from the
 * GET /api/ai/diagnose-chat route handler so the legacy REST endpoint
 * AND the new `system.diagnoseChat` tRPC procedure both call this one
 * function · drift between the two consumers is structurally
 * impossible.
 *
 * The probe runs synchronous health checks (AI provider-fleet
 * availability · Neon latency) + reads the last hour of chat-pipeline
 * ai_error audit events, slow chat generations, and non-chat ai_error
 * events, then assembles a markdown report. It deliberately does NOT
 * touch streamText / compression / brain-context — the whole point is
 * to diagnose a broken chat route WITHOUT going through it.
 *
 * Truth sources (2026-07-29): the chat route exports a bare POST and
 * never passes through the `apiHandler` request logger, so
 * `api_request_logs` has ZERO `/api/ai/chat` rows ever — reading it
 * here made the "Chat errors" / "Slow requests" sections structurally
 * vacuous (always "none"). Chat failures land in
 * `auditEvent(eventType="ai_error", actor="chat")` via `recordError`,
 * and every completed chat turn lands in `aiGeneration(feature="chat")`
 * with its duration via `trackGeneration` — those are the sections'
 * sources now.
 *
 * The return shape is the explicit flat `DiagnoseChatResult` (every
 * Date stringified) — no Prisma row reaches the AppRouter (TS2589
 * firewall).
 */

import { prisma } from "@/lib/prisma";
import { getProviderHealth } from "@/lib/ai/provider-health";

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
  /** Chat-pipeline ai_error audit rows (actor "chat"), last hour. */
  recentErrors: Array<{
    at: string;
    detail: string | null;
  }>;
  /** Completed chat generations that took >15s (AiGeneration feature="chat"). */
  slowRequests: Array<{
    at: string;
    durationMs: number | null;
    model: string;
  }>;
  /** ai_error rows from every non-chat actor (cron/brain/integrations) — fleet context. */
  aiErrorEvents: Array<{
    at: string;
    actor: string;
    detail: string | null;
  }>;
  /** Markdown report — the chat error-card renders this inline. */
  report: string;
}

async function checkProviders(): Promise<DiagnoseHealthCheck> {
  try {
    const snap = await getProviderHealth();
    const up = snap.providers.filter((p) => p.available).map((p) => p.name);
    const ok = snap.overallTone !== "red";
    return {
      name: "AI providers",
      ok,
      detail: up.length
        ? `${up.length} lane(s) up: ${up.join(", ")} (${snap.pillLabel})`
        : `no provider lanes available (${snap.pillLabel})`,
    };
  } catch (err) {
    return {
      name: "AI providers",
      ok: false,
      detail: err instanceof Error ? err.message.slice(0, 100) : "provider-health probe failed",
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
 * Run the full chat-route diagnostic. Pings the AI provider fleet +
 * Neon, reads the last hour of chat ai_error audit events / slow chat
 * generations / non-chat ai_error events, and assembles a markdown
 * report. Owner-only at both transports.
 */
export async function runChatDiagnostic(): Promise<DiagnoseChatResult> {
  const since = new Date(Date.now() - 60 * 60_000); // 1h

  const [providerCheck, dbCheck, chatErrorsRaw, slowGenerations, otherAiErrors] = await Promise.all([
    checkProviders(),
    checkDatabase(),
    prisma.auditEvent
      .findMany({
        where: { eventType: "ai_error", actor: "chat", createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { createdAt: true, detail: true },
      })
      // null = the trail itself was unreadable — the report says so
      // instead of fabricating an all-clear "none in the last hour".
      .catch(() => null),
    prisma.aiGeneration
      .findMany({
        where: { feature: "chat", createdAt: { gte: since }, durationMs: { gte: 15_000 } },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { createdAt: true, durationMs: true, model: true },
      })
      .catch(() => []),
    prisma.auditEvent
      .findMany({
        where: { eventType: "ai_error", actor: { not: "chat" }, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { createdAt: true, actor: true, detail: true },
      })
      .catch(() => []),
  ]);

  const recentErrors = chatErrorsRaw ?? [];

  const checks: DiagnoseHealthCheck[] = [providerCheck, dbCheck];
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

  if (chatErrorsRaw === null) {
    lines.push("## Chat errors");
    lines.push("- error trail unavailable — the ai_error audit query itself failed");
    lines.push("");
  } else if (recentErrors.length > 0) {
    lines.push(`## Chat errors (${recentErrors.length} in last hour)`);
    for (const e of recentErrors) {
      lines.push(
        `- ${new Date(e.createdAt).toLocaleTimeString()} · ${(e.detail ?? "no detail").slice(0, 120)}`,
      );
    }
    lines.push("");
  } else {
    lines.push("## Chat errors");
    lines.push("- none in the last hour (ai_error audit trail)");
    lines.push("");
  }

  if (slowGenerations.length > 0) {
    lines.push(`## Slow chat generations (>15s) — ${slowGenerations.length}`);
    for (const s of slowGenerations) {
      lines.push(`- ${new Date(s.createdAt).toLocaleTimeString()} · ${s.durationMs}ms · ${s.model}`);
    }
    lines.push("");
  }

  if (otherAiErrors.length > 0) {
    lines.push(`## Other AI errors (${otherAiErrors.length}, non-chat)`);
    for (const e of otherAiErrors) {
      lines.push(`- ${new Date(e.createdAt).toLocaleTimeString()} · ${e.actor} · ${(e.detail ?? "").slice(0, 100)}`);
    }
    lines.push("");
  }

  lines.push("## What to do next");
  if (!providerCheck.ok) {
    lines.push("- AI providers degraded/offline — open the ⋯ menu Provider Override and pin a known-good lane (Gemini/OpenAI/Claude).");
  }
  if (!dbCheck.ok) {
    lines.push("- Database is unresponsive. This blocks conversation save + brain context. Check Neon status.");
  }
  if (recentErrors.length > 0) {
    lines.push("- The chat pipeline logged real errors in the last hour (see above) — the newest one is the likely cause. Retry may work; if it repeats, pin a different provider lane in the ⋯ menu.");
  } else if (chatErrorsRaw !== null && allOk) {
    lines.push("- All checks pass and the chat error trail is clean. The stream drop was likely a transient network blip. Tap Retry.");
    lines.push("- If it keeps happening, pin a different provider lane in the ⋯ menu.");
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
      detail: e.detail,
    })),
    slowRequests: slowGenerations.map((s) => ({
      at: s.createdAt.toISOString(),
      durationMs: s.durationMs,
      model: s.model,
    })),
    aiErrorEvents: otherAiErrors.map((e) => ({
      at: e.createdAt.toISOString(),
      actor: e.actor,
      detail: e.detail,
    })),
    report: lines.join("\n"),
  };
}
