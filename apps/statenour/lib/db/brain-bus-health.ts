/**
 * Brain-bus health probe · v8.11 BATCH 63 · Apr 29.
 *
 * Composes on the v8.4 brain-bus skeleton (`publish` / `subscribe`) to
 * verify that the LISTEN/NOTIFY pipeline still round-trips end-to-end.
 *
 * Two failure modes this catches that nothing else does:
 *   1. Neon dropped LISTEN support on a connection class (has happened
 *      historically when they cycle infra) — `publish` still succeeds
 *      but no consumer ever hears the message. Without a probe the
 *      brain-bus dies silently and downstream consumers (embedding
 *      warmer, telegram firehose) just stop without erroring.
 *   2. The `pg` peer-dep got accidentally pruned from prod by a future
 *      pnpm dedup — `subscribe` throws clear "install pg" but the
 *      catcher swallows it; this probe re-surfaces it as an alert.
 *
 * Strategy:
 *   · Open a subscribe on `_health_probe` channel
 *   · Publish a uniquely-tagged envelope
 *   · Wait up to TIMEOUT_MS for the consumer callback
 *   · Tear down the subscription
 *   · Record round-trip latency, or alert on timeout / setup failure
 *
 * Folded into mega-evening — daily check is enough; if NOTIFY breaks at
 * 9am, we hear about it within 22h. Tighter cadence isn't worth the
 * added LISTEN-connection churn against Neon's connection cap.
 */

import { prisma } from "@/lib/prisma";
import { publish, subscribe, makeBusId } from "@/lib/db/brain-bus";

const PROBE_CHANNEL = "_health_probe";
const TIMEOUT_MS = 8_000;
const ALERT_CATEGORY = "brain_bus_alert";
const ALERT_KEY_PREFIX = "probe-fail";

export interface HealthProbeReport {
  ranAt: string;
  ok: boolean;
  mode: "round_trip" | "publish_only" | "failed";
  latencyMs: number | null;
  reason?: string;
  alertWritten: boolean;
}

export async function runBrainBusProbe(): Promise<HealthProbeReport> {
  const ranAt = new Date().toISOString();
  const probeId = makeBusId();

  let unsubscribe: (() => Promise<void>) | null = null;
  let received = false;
  let receivedAt: number | null = null;

  // 1. Set up the listener first so we don't race the publish.
  try {
    unsubscribe = await subscribe<{ probeId: string }>(
      PROBE_CHANNEL,
      (env) => {
        if (env.payload?.probeId === probeId) {
          received = true;
          receivedAt = Date.now();
        }
      },
    );
  } catch (err) {
    // v9.1.16 · publish-only fallback now reports ok:FALSE and writes
    // an alert. The previous behavior (ok:true with mode="publish_only")
    // hid LISTEN-side failures: the operator dashboard saw "green" but
    // the entire downstream consumer pipeline (embedding warmer, brain-
    // bus-consume, Telegram firehose) was dead. The whole point of the
    // probe is to verify the round-trip; a one-way pg_notify success
    // proves nothing about consumer liveness.
    const reason = err instanceof Error ? err.message : "subscribe failed";
    const publishedAt = Date.now();
    try {
      await publish(PROBE_CHANNEL, { probeId, mode: "publish_only" });
      const latency = Date.now() - publishedAt;
      const alertWritten = await writeAlert(
        ranAt,
        `Brain-bus probe degraded · LISTEN/subscribe path failed (publish still works). reason: ${reason}. Downstream consumers (embedding warmer, brain-bus-consume, Telegram firehose) are likely dark.`,
      );
      return {
        ranAt,
        ok: false, // was true — fixed in v9.1.16
        mode: "publish_only",
        latencyMs: latency,
        reason: `subscribe unavailable (${reason}); publish-only confirmed but consumer pipeline NOT verified — degraded`,
        alertWritten,
      };
    } catch (pubErr) {
      const pubReason = pubErr instanceof Error ? pubErr.message : "publish failed";
      const alertWritten = await writeAlert(
        ranAt,
        `Brain-bus probe failed · subscribe + publish both errored. subscribe: ${reason}. publish: ${pubReason}.`,
      );
      return {
        ranAt,
        ok: false,
        mode: "failed",
        latencyMs: null,
        reason: `subscribe: ${reason}; publish: ${pubReason}`,
        alertWritten,
      };
    }
  }

  // 2. Publish, then poll for receipt.
  const publishedAt = Date.now();
  try {
    await publish(PROBE_CHANNEL, { probeId, mode: "round_trip" });
  } catch (err) {
    await unsubscribe();
    const reason = err instanceof Error ? err.message : "publish failed";
    const alertWritten = await writeAlert(
      ranAt,
      `Brain-bus probe failed · publish errored after subscribe succeeded: ${reason}`,
    );
    return {
      ranAt,
      ok: false,
      mode: "failed",
      latencyMs: null,
      reason,
      alertWritten,
    };
  }

  const deadline = publishedAt + TIMEOUT_MS;
  while (!received && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }

  await unsubscribe();

  if (!received) {
    const alertWritten = await writeAlert(
      ranAt,
      `Brain-bus probe TIMEOUT · published probe ${probeId} but never received it back within ${TIMEOUT_MS}ms. LISTEN/NOTIFY pipeline appears dead — investigate Neon connection class or pg peer-dep.`,
    );
    return {
      ranAt,
      ok: false,
      mode: "failed",
      latencyMs: null,
      reason: `round-trip timeout after ${TIMEOUT_MS}ms`,
      alertWritten,
    };
  }

  const latency = (receivedAt ?? Date.now()) - publishedAt;
  return {
    ranAt,
    ok: true,
    mode: "round_trip",
    latencyMs: latency,
    alertWritten: false,
  };
}

async function writeAlert(ranAt: string, content: string): Promise<boolean> {
  // Hour-bucket key so consecutive failures within an hour collapse to
  // one alert (avoids flood if NOTIFY is broken for hours).
  const hourKey = ranAt.slice(0, 13);
  try {
    await prisma.brainMemory.create({
      data: {
        category: ALERT_CATEGORY,
        key: `${ALERT_KEY_PREFIX}:${hourKey}`,
        content,
        confidence: 0.95,
        source: "cron:brain-bus-probe",
      },
    });
    return true;
  } catch (err: unknown) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
      return false; // duplicate — already alerted this hour
    }
    console.warn("[brain-bus-probe] alert write failed:", err);
    return false;
  }
}
