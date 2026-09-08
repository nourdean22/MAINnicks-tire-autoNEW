/**
 * Langfuse scores · 2026-09-08 (program U6).
 *
 * The operator's thumbs on a chat turn were stored on the ChatMessage row and
 * nowhere else; Langfuse held the trace with no verdict attached, so "which
 * model/prompt produced answers the operator liked" could not be asked
 * there. This posts a NUMERIC score keyed by the turn's traceId through the
 * public REST API (the app uses `@langfuse/otel` for spans and has no client
 * SDK). Fire-and-forget: a failure is logged and never reaches the caller.
 */
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("observability/langfuse-scores");

export interface LangfuseScoreInput {
  traceId: string | null | undefined;
  /** Score name, low cardinality (`operator_thumb`). */
  name: string;
  value: number;
  comment?: string;
}

type Env = Record<string, string | undefined>;
type FetchLike = (input: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

export function langfuseScoreConfig(env: Env = process.env): { baseUrl: string; auth: string } | null {
  const pk = env.LANGFUSE_PUBLIC_KEY;
  const sk = env.LANGFUSE_SECRET_KEY;
  if (!pk || !sk) return null;
  const baseUrl = (env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com").replace(/\/+$/, "");
  return { baseUrl, auth: "Basic " + Buffer.from(`${pk}:${sk}`).toString("base64") };
}

/** Returns true when the score was accepted. Never throws. */
export async function sendLangfuseScore(
  input: LangfuseScoreInput,
  deps: { env?: Env; fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<boolean> {
  if (!input.traceId) return false;
  const cfg = langfuseScoreConfig(deps.env ?? process.env);
  if (!cfg) return false;
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 3_000);
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/api/public/scores`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: cfg.auth },
      body: JSON.stringify({
        traceId: input.traceId,
        name: input.name,
        value: input.value,
        dataType: "NUMERIC",
        ...(input.comment ? { comment: input.comment.slice(0, 1000) } : {}),
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      log.warn("langfuse_score_rejected", { status: res.status, name: input.name });
      return false;
    }
    return true;
  } catch (err) {
    log.warn("langfuse_score_failed", { name: input.name, error: err instanceof Error ? err.message : String(err) });
    return false;
  } finally {
    clearTimeout(timer);
  }
}
