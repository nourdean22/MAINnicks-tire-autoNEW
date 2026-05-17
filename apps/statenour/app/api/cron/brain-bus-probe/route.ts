/**
 * /api/cron/brain-bus-probe · v8.11 BATCH 63 · Apr 29.
 *
 * Folded into mega-evening. Round-trips a NOTIFY envelope through the
 * brain-bus to verify the LISTEN/NOTIFY pipeline is alive. Writes a
 * `brain_bus_alert` BrainMemory row on failure so the v8.5 telegram
 * bridge surfaces it on Nour's phone.
 */

import { cronHandler } from "@/lib/utils/http";
import { runBrainBusProbe } from "@/lib/db/brain-bus-health";

export const maxDuration = 30;

export const GET = cronHandler(async () => {
  const started = Date.now();
  try {
    const report = await runBrainBusProbe();
    return { durationMs: Date.now() - started, ...report };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : "brain-bus-probe failed",
    };
  }
});
