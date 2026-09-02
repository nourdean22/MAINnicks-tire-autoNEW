/**
 * POST /api/system/observability-probe — plant a known positive in each
 * observability sink, from inside the deployed process.
 *
 * Cron-secret gated (Authorization: Bearer $CRON_SECRET), exactly like
 * /api/system/perplexica-diag. Why it exists: on 2026-09-02 production had
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
  const t0 = Date.now();
  try {
    const result = await generateText({
      model: getModel("fast"),
      prompt: `Reply with exactly this and nothing else: pong ${probeId}`,
      maxOutputTokens: 16,
      experimental_telemetry: langfuseTelemetry({
        functionId: "observability-probe",
        tags: ["probe"],
        metadata: { probeId },
      }),
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
    return { status, enabled, ok: false, error: String(error).slice(0, 240), durationMs: Date.now() - t0 };
  }
}

async function probeSentry(probeId: string) {
  const enabled = Boolean(resolveSentryDsn());
  const t0 = Date.now();
  try {
    const Sentry = await import("@sentry/nextjs");
    const eventId = Sentry.captureMessage(`observability-probe ${probeId}`, {
      level: "info",
      tags: { probe: "true", probeId },
    });
    const flushed = await Sentry.flush(5000);
    return { enabled, ok: true, eventId, flushed, durationMs: Date.now() - t0 };
  } catch (error) {
    return { enabled, ok: false, error: String(error).slice(0, 240), durationMs: Date.now() - t0 };
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
