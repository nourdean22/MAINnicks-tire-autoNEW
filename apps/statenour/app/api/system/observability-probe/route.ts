/**
 * POST /api/system/observability-probe — plant a known positive in each
 * observability sink, from inside the deployed process.
 *
 * Cron-secret gated (Authorization: Bearer $CRON_SECRET), exactly like
 * /api/cron/*. Why it exists: on 2026-09-02 production had
 * real Langfuse keys, the boot log said `langfuse_started`, the log showed
 * model calls succeeding an hour later — and Langfuse held zero observations.
 * A green badge, a started processor and a silent sink are indistinguishable
 * from outside; only a trace you planted yourself, read back by its probe id,
 * separates "nothing happened" from "the pipeline is dead".
 *
 *   · langfuse — one tiny AI SDK call (fast lane, ≤ 16 output tokens) traced
 *     as `observability-probe` with the probe id in metadata, then a flush.
 *     Read back with GET /api/public/v2/observations (name = observability-probe).
 *   · sentry — one info-level message tagged probe=true, then a flush.
 *     Read back by event id.
 *
 * `ok` is TRUE only when the sink was actually enabled AND the export was
 * flushed. A disabled sink reports ok:false with a reason — never a green.
 *
 * Observe-only: no database writes, no memory, no side effects beyond the two
 * vendor exports. Body: { targets?: ("langfuse" | "sentry")[] } — default both.
 */
import { generateText } from "ai";
import { nanoid } from "nanoid";
import { apiHandler } from "@/lib/utils/http";
import { getModel } from "@/lib/ai/provider";
import {
  flushLangfuseTraces,
  isLangfuseTelemetryEnabled,
  langfuseTelemetry,
  langfuseTracingStatus,
} from "@/lib/observability/langfuse";
import { resolveSentryDsn } from "@/lib/observability/sentry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Target = "langfuse" | "sentry";
const ALL_TARGETS: Target[] = ["langfuse", "sentry"];

async function probeLangfuse(probeId: string) {
  const status = langfuseTracingStatus();
  const enabled = isLangfuseTelemetryEnabled(false);

  // A known positive that cannot be exported is not a positive. If tracing is
  // skipped or failed, `langfuseTelemetry()` returns isEnabled:false and
  // `flushLangfuseTraces()` is a no-op — a model call would still succeed and
  // this probe would have reported ok:true with no observation ever created.
  // That is precisely the false green the probe exists to catch (found in
  // review on #2079).
  if (!enabled) {
    return {
      status,
      enabled,
      ok: false,
      flushed: false,
      reason:
        status === "skipped"
          ? "Langfuse is unconfigured (no keys) — nothing was exported"
          : `Langfuse tracing status is "${status}" — spans are not reaching the processor, so nothing was exported`,
    };
  }

  const t0 = Date.now();
  try {
    const telemetry = langfuseTelemetry({
      functionId: "observability-probe",
      tags: ["probe"],
      metadata: { probeId },
    });
    // Belt and braces: the gate is re-read here, so a race that flips the
    // status mid-probe cannot produce an untraced "success".
    if (!telemetry.isEnabled) {
      return { status, enabled, ok: false, flushed: false, reason: "telemetry block came back disabled at call time" };
    }

    const result = await generateText({
      model: getModel("fast"),
      prompt: `Reply with exactly this and nothing else: pong ${probeId}`,
      maxOutputTokens: 16,
      experimental_telemetry: telemetry,
    });
    await flushLangfuseTraces();
    return {
      status,
      enabled,
      ok: true,
      flushed: true,
      text: result.text.slice(0, 60),
      modelId: result.response?.modelId ?? null,
      durationMs: Date.now() - t0,
    };
  } catch (error) {
    return { status, enabled, ok: false, flushed: false, error: String(error).slice(0, 240), durationMs: Date.now() - t0 };
  }
}

async function probeSentry(probeId: string) {
  const enabled = Boolean(resolveSentryDsn());

  // Same rule as the Langfuse branch: with no DSN, captureMessage still
  // returns an id and flush() still resolves, so ok:true would be a lie.
  if (!enabled) {
    return { enabled, ok: false, flushed: false, reason: "no valid SENTRY_DSN — the SDK is disabled and nothing was sent" };
  }

  const t0 = Date.now();
  try {
    const Sentry = await import("@sentry/nextjs");
    const eventId = Sentry.captureMessage(`observability-probe ${probeId}`, {
      level: "info",
      tags: { probe: "true", probeId },
    });
    const flushed = await Sentry.flush(5000);
    return {
      enabled,
      ok: Boolean(eventId) && flushed,
      eventId: eventId ?? null,
      flushed,
      ...(flushed ? {} : { reason: "Sentry.flush() timed out — the event may not have left the process" }),
      durationMs: Date.now() - t0,
    };
  } catch (error) {
    return { enabled, ok: false, flushed: false, error: String(error).slice(0, 240), durationMs: Date.now() - t0 };
  }
}

export const POST = apiHandler(
  async (req) => {
    const body = (await req.json().catch(() => ({}))) as { targets?: unknown };
    const requested = Array.isArray(body.targets)
      ? (body.targets.filter((t): t is Target => t === "langfuse" || t === "sentry") as Target[])
      : [];
    const targets = new Set<Target>(requested.length > 0 ? requested : ALL_TARGETS);
    const probeId = nanoid(10);
    const startedAt = new Date().toISOString();

    return {
      probeId,
      startedAt,
      targets: [...targets],
      ...(targets.has("langfuse") ? { langfuse: await probeLangfuse(probeId) } : {}),
      ...(targets.has("sentry") ? { sentry: await probeSentry(probeId) } : {}),
    };
  },
  { auth: "cron" },
);
