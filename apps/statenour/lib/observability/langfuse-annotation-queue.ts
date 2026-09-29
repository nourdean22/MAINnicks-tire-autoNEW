/**
 * Q-32 · one Langfuse annotation queue.
 *
 * Current upstream contract (verified 2026-09-29):
 * POST /api/public/annotation-queues/{queueId}/items
 * { objectId, objectType: "TRACE", status: "PENDING" }
 *
 * No queue id or no Langfuse keys => clean no-op. The product must never fail
 * because the evaluation workbench is unavailable.
 */

import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("observability/langfuse-annotation-queue");

type Env = Record<string, string | undefined>;
type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number }>;

export interface LangfuseAnnotationQueueConfig {
  baseUrl: string;
  auth: string;
  queueId: string;
}

export function langfuseAnnotationQueueConfig(
  env: Env = process.env,
): LangfuseAnnotationQueueConfig | null {
  const pk = env.LANGFUSE_PUBLIC_KEY?.trim();
  const sk = env.LANGFUSE_SECRET_KEY?.trim();
  const queueId = env.LANGFUSE_ANNOTATION_QUEUE_ID?.trim();
  if (!pk || !sk || !queueId) return null;
  const baseUrl = (env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com").replace(/\/+$/, "");
  return {
    baseUrl,
    queueId,
    auth: "Basic " + Buffer.from(`${pk}:${sk}`).toString("base64"),
  };
}

/**
 * Returns true only when Langfuse accepted the trace into the configured queue.
 * Duplicate/conflict responses are non-fatal; callers remain fire-and-forget.
 */
export async function enqueueLangfuseTraceForAnnotation(
  traceId: string | null | undefined,
  deps: { env?: Env; fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<boolean> {
  if (!traceId) return false;
  const cfg = langfuseAnnotationQueueConfig(deps.env ?? process.env);
  if (!cfg) return false;

  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 3_000);
  try {
    const res = await fetchImpl(
      `${cfg.baseUrl}/api/public/annotation-queues/${encodeURIComponent(cfg.queueId)}/items`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: cfg.auth,
        },
        body: JSON.stringify({
          objectId: traceId,
          objectType: "TRACE",
          status: "PENDING",
        }),
        signal: ctrl.signal,
      },
    );
    if (!res.ok) {
      log.warn("langfuse_annotation_queue_rejected", {
        status: res.status,
        queueId: cfg.queueId,
      });
      return false;
    }
    return true;
  } catch (err) {
    log.warn("langfuse_annotation_queue_failed", {
      queueId: cfg.queueId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  } finally {
    clearTimeout(timer);
  }
}
