/**
 * Cron · vapi-harness · 2026-05-18 PM
 *
 * Runs the VAPI synthetic-call harness nightly (and every 6h is fine
 * too · cheap). Catches config drift + dispatcher silence in <24h
 * instead of the 5-day silent loss we saw in wave-181.50.
 *
 * Behavior:
 *   · All checks pass → returns success, no alert (no spam)
 *   · ANY check fails → throws (so cron_log marks 'failed' AND
 *     cronSkipWatchdog catches it on next pass) + fires a Telegram
 *     alert inline (belt + suspenders)
 *
 * Telegram dedup · module-level marker keeps a multi-fire cron from
 * spamming · only one alert per UTC day even if the cron runs hourly.
 *
 * Delegates 100% to `lib/services/vapi-harness.runVapiHarness` so the
 * standalone `scripts/vapi-harness.ts` runs the exact same checks.
 */

import { createLogger } from "../../lib/logger";
import { runVapiHarness } from "../../services/vapi-harness";

const log = createLogger("cron:vapi-harness");

// Module-level dedup · prevents multi-fire alerts on the same UTC day.
// Resets on process restart (which is rare enough that hourly runs
// can't spam more than once per restart).
let lastAlertDate: string | null = null;

export async function processVapiHarness(): Promise<{
  recordsProcessed: number;
  details?: string;
}> {
  const result = await runVapiHarness();

  log.info("vapi-harness run complete", {
    pass: result.pass,
    total: result.checks.length,
    failed: result.checks.filter((c) => !c.pass).length,
  });

  if (result.pass) {
    return {
      recordsProcessed: result.checks.length,
      details: result.summary,
    };
  }

  // Failure path · fire Telegram + throw to mark cron_log as failed.
  const today = new Date().toISOString().slice(0, 10);
  if (lastAlertDate !== today) {
    try {
      const { sendTelegramMessage } = await import("../../services/telegram");
      const failedChecks = result.checks.filter((c) => !c.pass);
      const lines = [
        "🚨 VAPI HARNESS · failures detected",
        "",
        result.summary,
        "",
        "Failed checks:",
        ...failedChecks.map((c) => {
          const detail = c.err ?? c.details ?? "";
          return `  · ${c.name}${detail ? ` — ${detail}` : ""}`;
        }),
        "",
        "Likely root causes (in order of prior incidents):",
        "  1. server.url field unset/wrong on assistant config (wave-181.50)",
        "  2. server.secret cleared by a recent PATCH (injectWebhookSecret guard)",
        "  3. webhook endpoint 5xx (check Railway logs)",
        "  4. tool dispatcher renamed/removed",
      ];
      await sendTelegramMessage(lines.join("\n"), "critical");
      lastAlertDate = today;
    } catch (err) {
      log.error("vapi-harness · telegram alert failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  throw new Error(`VAPI harness failed · ${result.summary}`);
}
