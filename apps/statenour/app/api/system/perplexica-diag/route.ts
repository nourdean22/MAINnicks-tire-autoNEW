/**
 * GET /api/system/perplexica-diag — the `/perplexica` diagnostic command.
 *
 * Cron-secret gated (Authorization: Bearer $CRON_SECRET). Proves the LIVE
 * production search path end-to-end FROM INSIDE Railway — the Perplexica core
 * lives on the private network (…perplexica.railway.internal:3000) and is
 * unreachable externally, so this endpoint is the only honest way to verify it.
 *
 * It runs exactly what the chat's arsenalWebSearch primary branch runs:
 *   1. active health probe  → provider + model verification
 *   2. askPerplexica(query) → capped at PERPLEXICA_TIMEOUT_MS (production budget)
 *   3. on empty/timeout     → the same metered multiSourceSearch fallback quorum
 *
 * Returns a full receipt: tool, source (arsenal/perplexica | fallback/<name>),
 * model, citations, contentChars, durationMs, traceId, fallbackUsed,
 * failureReason, health, telemetry. Observe-only — performs NO writes.
 *
 * Query params: ?q=<search query> overrides the default probe query.
 */
import { apiHandler, jsonOk } from "@/lib/utils/http";
import {
  askPerplexica,
  checkPerplexicaHealth,
  getPerplexicaTelemetry,
  hasPerplexica,
  PERPLEXICA_TIMEOUT_MS,
} from "@/lib/integrations/perplexica";
import { logger as rootLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const DEFAULT_QUERY = "Ohio E-Check emissions testing requirements 2026";

/** Race a promise against a wall-clock cap; resolve null on either failure. */
function capped<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export const GET = apiHandler(
  async (req, ctx) => {
    const log = rootLogger.withSurface("system/perplexica-diag");
    const query = (new URL(req.url).searchParams.get("q") || DEFAULT_QUERY).slice(0, 300);
    const traceId = ctx.requestId;

    // 1 · active health / provider + model verification
    const health = await checkPerplexicaHealth();

    // 2 · real arsenal-primary search — same helper + budget the chat tool uses
    const t0 = Date.now();
    let source = "none";
    let model: string | null = null;
    let citations: Array<{ url: string; title?: string }> = [];
    let contentChars = 0;
    let fallbackUsed = false;
    let failureReason: string | null = null;

    if (hasPerplexica()) {
      const primary = await capped(
        askPerplexica(query, { optimizationMode: "speed" }),
        PERPLEXICA_TIMEOUT_MS,
      );
      if (primary?.content?.trim()) {
        source = "arsenal/perplexica";
        model = primary.model;
        citations = primary.citations;
        contentChars = primary.content.trim().length;
      } else {
        failureReason = "perplexica primary returned empty or timed out";
      }
    } else {
      failureReason = "PERPLEXICA_API_URL not configured";
    }

    // 3 · fallback quorum (mirrors arsenalWebSearch) when the primary is empty
    if (source === "none") {
      fallbackUsed = true;
      const { multiSourceSearch } = await import("@/lib/ai/multi-search");
      const q = await multiSourceSearch(query, {
        sources: ["perplexity", "tavily", "exa", "google"],
      });
      const won = q.sources[0];
      if (won) {
        source = `fallback/${won.name}`;
        model = won.model;
        citations = q.citations.map((c) => ({ url: c.url, title: c.title }));
        contentChars = (q.consensus ?? won.content ?? "").trim().length;
      } else {
        failureReason = `${failureReason ?? "primary failed"}; fallback quorum returned no results`;
      }
    }

    const receipt = {
      tool: "arsenalWebSearch",
      query,
      source,
      model,
      citations: citations.length,
      citationSample: citations.slice(0, 3),
      contentChars,
      durationMs: Date.now() - t0,
      traceId,
      fallbackUsed,
      failureReason,
      health,
      telemetry: getPerplexicaTelemetry(),
    };

    log.info("perplexica_diag", {
      source,
      fallbackUsed,
      healthOk: health.ok,
      durationMs: receipt.durationMs,
      citations: receipt.citations,
      traceId,
    });
    return jsonOk(receipt);
  },
  { auth: "cron" },
);
