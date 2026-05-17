import { generateText } from "ai";
import { getModelWithFallback, getActiveProviderInfo } from "@/lib/ai/provider";
import { buildSystemPrompt } from "@/lib/ai/system-prompt";
import { trackGeneration } from "@/lib/ai/track";
import { mintTraceId, recordTrace } from "@/lib/ai/agent-trace";
import { runDriftScan } from "@/lib/mastery/drift-engine";
import { prisma } from "@/lib/prisma";
import { cronHandler } from "@/lib/utils/http";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/drift-check");

import { daysAgo, toDateString } from "@/lib/utils/datetime";
export const maxDuration = 60;

export const GET = cronHandler(async () => {
  // Step 1: Run the drift detection engine
  const firedAlerts = await runDriftScan();

  // Step 2: If new alerts fired, generate AI analysis for each
  const analyses: Array<{ alertRule: string; analysis: string }> = [];

  if (firedAlerts.length > 0) {
    const model = await getModelWithFallback();
    const { provider, modelId } = getActiveProviderInfo();
    const systemPrompt = await buildSystemPrompt();
    // v10 E.5 — root traceId for the whole drift-analysis batch.
    // Each per-alert AI call chains underneath via parentId so the
    // operator sees one collapsed row with N children per cron run.
    const rootTraceId = mintTraceId();
    // Write the root row first — listRecentTraceChains picks the row
    // with parentId == null as the chain root. Without this, the
    // first child would be mis-rendered as the root label.
    void recordTrace(
      {
        traceId: rootTraceId,
        source: "cron",
        label: "drift-check-batch",
        provider,
        model: modelId,
        metadata: { alertCount: firedAlerts.length },
      },
      { durationMs: 0 },
    );

    // Apr 19 · DailyScore retired. Use live signals for drift context.
    const [identityRow, overdueCommits, openContradictions] = await Promise.all([
      prisma.brainMemory
        .findUnique({
          where: { category_key: { category: "identity_snapshot", key: "current" } },
          select: { content: true },
        })
        .catch(() => null),
      prisma.commitment
        .count({
          where: {
            status: "active",
            deadline: { lt: toDateString(new Date()) },
          },
        })
        .catch(() => 0),
      prisma.brainMemory
        .count({
          where: {
            category: "contradiction",
            createdAt: { gte: daysAgo(7) },
          },
        })
        .catch(() => 0),
    ]);

    let scoresContext = "";
    if (identityRow?.content) {
      try {
        const snap = JSON.parse(identityRow.content) as { axes: Record<string, { value: number; manual: number | null; direction: string }> };
        const axes = Object.entries(snap.axes ?? {});
        const rows = axes.map(([name, a]) => `${name}: ${a.manual ?? a.value}/100 ${a.direction === "rising" ? "↑" : a.direction === "falling" ? "↓" : "·"}`);
        scoresContext = `Identity snapshot (live 8-axis self-model):\n${rows.join("\n")}`;
      } catch {
        scoresContext = "Identity snapshot unreadable.";
      }
    } else {
      scoresContext = "Identity snapshot not yet computed.";
    }
    scoresContext += `\nOverdue commitments: ${overdueCommits} · Open contradictions (7d): ${openContradictions}`;

    for (const alert of firedAlerts) {
      try {
        const startTime = Date.now();

        const result = await generateText({
          model,
          system: systemPrompt,
          prompt: `A drift alert just fired. Analyze it briefly.

Alert: [${alert.severity.toUpperCase()}] ${alert.rule_name}
Message: ${alert.message}

Current state:
${scoresContext}

In 2-3 sentences: What pattern is this? What's the root cause? What's the one intervention?`,
        });

        const durationMs = Date.now() - startTime;

        analyses.push({
          alertRule: alert.rule_name,
          analysis: result.text,
        });

        await trackGeneration({
          feature: "cron:drift-analysis",
          model: modelId,
          promptTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          durationMs,
          status: "complete",
        });

        // v10 E.5 · agent-trace — child of the rootTraceId. parentId
        // points back at rootTraceId so listRecentTraceChains renders
        // the batch as one chain with N children, not N orphans.
        void recordTrace(
          {
            traceId: rootTraceId,
            parentId: rootTraceId,
            source: "cron",
            label: `drift-analysis:${alert.rule_name}`,
            provider,
            model: modelId,
            metadata: {
              alertRule: alert.rule_name,
              severity: alert.severity,
            },
          },
          {
            durationMs,
            outputChars: result.text.length,
          },
        );
      } catch {
        // Skip AI analysis if it fails for a single alert
        analyses.push({
          alertRule: alert.rule_name,
          analysis: "AI analysis unavailable.",
        });
      }
    }
  }

  // Step 3: Push critical/high alerts to Telegram immediately
  const urgentAlerts = firedAlerts.filter(a => a.severity === "critical" || a.severity === "high");
  if (urgentAlerts.length > 0) {
    try {
      const { sendTelegram, formatTelegramNotification } = await import("@/lib/services/telegram");
      const alertLines = urgentAlerts.map(a => {
        const analysis = analyses.find(x => x.alertRule === a.rule_name);
        return `[${a.severity.toUpperCase()}] ${a.rule_name}\n${a.message}${analysis?.analysis ? `\n→ ${analysis.analysis}` : ""}`;
      }).join("\n\n");
      await sendTelegram(formatTelegramNotification(
        `⚠️ DRIFT ALERT — ${urgentAlerts.length} issue${urgentAlerts.length > 1 ? "s" : ""} detected`,
        alertLines
      ));
    } catch (telegramErr) {
      log.error("telegram_push_failed", { err: telegramErr instanceof Error ? telegramErr.message : String(telegramErr) });
    }
  }

  return {
    alertsFired: firedAlerts.length,
    alerts: firedAlerts,
    analyses,
    telegramPushed: urgentAlerts.length,
  };
});
