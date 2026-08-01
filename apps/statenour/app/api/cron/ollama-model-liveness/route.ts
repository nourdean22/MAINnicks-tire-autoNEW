/**
 * GET /api/cron/ollama-model-liveness · 2026-08-01.
 *
 * Daily proof-of-life for the Ollama Cloud lanes (chat / fast / vision).
 *
 * Ollama Cloud retires models with no warning. This key has lost two —
 * qwen3-vl:235b-instruct (vision, 2026-06-16) and deepseek-v3.1:671b
 * (chat, 2026-07-15) — and in both cases the first signal was a human
 * noticing broken output. The vision one ran dead in PRODUCTION for
 * roughly six weeks after the registry had already been corrected,
 * because Railway pinned OLLAMA_VISION_MODEL to the retired id and an
 * env override beats the registry default.
 *
 * This route closes that blind spot: it calls the models the app would
 * actually resolve, and any lane that is not 200 raises Telegram. A 410
 * is called out separately — it means "retired forever", not "retry".
 *
 * cronHandler provides cron auth + its own CronJobLog persistence.
 */
import { cronHandler } from "@/lib/utils/http";
import { probeOllamaLanes, summarizeLanes } from "@/lib/ai/model-liveness";
import { sendTelegram, formatTelegramNotification } from "@/lib/services/telegram";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/ollama-model-liveness");

export const GET = cronHandler(async () => {
  const report = await probeOllamaLanes();
  const summary = summarizeLanes(report.probes);

  if (report.ok) {
    log.info("ollama_lanes_alive", {
      lanes: report.probes.map((p) => ({
        lane: p.lane,
        model: p.model,
        latencyMs: p.latencyMs,
      })),
    });
    return { ok: true, probes: report.probes };
  }

  const retired = report.failing.filter((p) => p.state === "retired");
  const title =
    retired.length > 0
      ? "Ollama model RETIRED — a lane is permanently dead"
      : "Ollama lane failing liveness probe";

  const runbook =
    retired.length > 0
      ? `A retired model NEVER comes back — pick a successor and re-point the lane. ` +
        `Verify a candidate first: curl -s -o /dev/null -w '%{http_code}' -X POST ` +
        `https://ollama.com/v1/chat/completions -H "Authorization: Bearer $OLLAMA_API_KEY" ` +
        `-H 'Content-Type: application/json' -d '{"model":"<candidate>","messages":` +
        `[{"role":"user","content":"ping"}],"max_tokens":1}' — then update ` +
        `config/ai-providers.ts AND clear any stale Railway pin ` +
        `(railway variables --service statenour-web | grep OLLAMA). ` +
        `A registry fix alone does NOT reach prod while an env override is set — ` +
        `that is exactly how the vision lane stayed dead for six weeks.`
      : `Check the key's quota and Ollama Cloud status before changing model ids.`;

  await sendTelegram(
    formatTelegramNotification(`${title}`, `${summary}\n\n${runbook}`, "high"),
  );
  log.warn("ollama_lane_failing", {
    failing: report.failing,
    retiredCount: retired.length,
  });

  return { ok: false, probes: report.probes, alerted: true };
});
