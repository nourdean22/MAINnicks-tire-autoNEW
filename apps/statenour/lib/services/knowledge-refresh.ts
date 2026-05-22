/**
 * lib/services/knowledge-refresh.ts · straggler-pages REST→tRPC slice
 * (2026-05-22).
 *
 * Lifted verbatim from app/api/admin/knowledge-refresh/route.ts so the
 * legacy REST endpoint AND the new `operator.knowledgeRefresh` tRPC
 * procedure call the same function · drift between consumers
 * structurally impossible.
 *
 * `runKnowledgeRefresh` fans out to all knowledge-pull cron routes,
 * then hot-flushes the system-prompt cache. The fan-out targets are
 * the project's own /api/cron/* endpoints, so the function needs the
 * caller's request headers to derive the absolute base URL (host +
 * forwarded-proto) — the cron routes are gated by CRON_SECRET, which
 * is forwarded as a Bearer token.
 */

import { hotFlushPromptCache } from "@/lib/ai/system-prompt-cache";

interface RefreshSubsystemResult {
  id: string;
  path: string;
  ok: boolean;
  status: number;
  durationMs: number;
  summary: string;
}

export interface KnowledgeRefreshResult {
  ok: boolean;
  targets: number;
  succeeded: number;
  failed: number;
  durationMs: number;
  flushedPromptCache: boolean;
  results: RefreshSubsystemResult[];
}

/** Thrown for the misconfiguration / no-targets cases the legacy
 *  route surfaced as 4xx/5xx · the route + the tRPC procedure both
 *  map the carried `status` onto the right transport error. */
export class KnowledgeRefreshError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "KnowledgeRefreshError";
    this.status = status;
    this.code = code;
  }
}

const SUBSYSTEMS = [
  {
    id: "industry",
    path: "/api/cron/industry-pull",
    description: "automotive RSS feeds",
  },
  {
    id: "stories",
    path: "/api/cron/alg-stories-pull",
    description: "ALG customer stories",
  },
  {
    id: "insights",
    path: "/api/cron/insights-pull",
    description: "Meta IG/FB insights",
  },
  { id: "gmail", path: "/api/cron/ingest-gmail", description: "Gmail ingest" },
  {
    id: "calendar",
    path: "/api/cron/ingest-calendar",
    description: "Calendar ingest",
  },
  {
    id: "drive",
    path: "/api/cron/ingest-drive",
    description: "Drive doc ingest",
  },
  {
    id: "knowledge",
    path: "/api/cron/knowledge-sync",
    description: "Knowledge file sync",
  },
  {
    id: "embed",
    path: "/api/cron/embed-backfill",
    description: "Embedding backfill",
  },
];

/**
 * Fan out to every knowledge-pull cron, then hot-flush the prompt
 * cache. `headers` supplies host + x-forwarded-proto for the absolute
 * base URL; `only` optionally narrows the subsystem set.
 */
export async function runKnowledgeRefresh(args: {
  headers: Headers;
  only?: string[];
}): Promise<KnowledgeRefreshResult> {
  const targets =
    args.only && args.only.length > 0
      ? SUBSYSTEMS.filter((s) => args.only!.includes(s.id))
      : SUBSYSTEMS;

  if (targets.length === 0) {
    throw new KnowledgeRefreshError("no targets", 400, "no_targets");
  }

  // v8.21 · the admin endpoint forwards CRON_SECRET to fan-out cron
  // routes. If it's not configured, those calls would 401 anyway, so
  // surface the misconfiguration clearly here instead of silently
  // failing every fan-out target.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new KnowledgeRefreshError(
      "CRON_SECRET not configured",
      500,
      "ENV_MISSING",
    );
  }
  const host = args.headers.get("host") ?? "localhost:3000";
  const proto = args.headers.get("x-forwarded-proto") ?? "https";
  const baseUrl = `${proto}://${host}`;

  const t0 = Date.now();
  const settled = await Promise.allSettled(
    targets.map(async (sub) => {
      const tStart = Date.now();
      try {
        const res = await fetch(`${baseUrl}${sub.path}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${cronSecret}` },
          signal: AbortSignal.timeout(60_000),
        });
        const data = (await res.json().catch(() => ({}))) as {
          summary?: string;
          message?: string;
        };
        return {
          id: sub.id,
          path: sub.path,
          ok: res.ok,
          status: res.status,
          durationMs: Date.now() - tStart,
          summary: data.summary ?? data.message ?? `${res.status}`,
        };
      } catch (err) {
        return {
          id: sub.id,
          path: sub.path,
          ok: false,
          status: 0,
          durationMs: Date.now() - tStart,
          summary: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  // Final hot-flush so the next chat turn sees the freshly-refreshed
  // knowledge.
  hotFlushPromptCache(
    `admin knowledge-refresh — ${targets.length} subsystems`,
  );

  const flat: RefreshSubsystemResult[] = settled.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : {
          id: "?",
          path: "?",
          ok: false,
          status: 0,
          durationMs: 0,
          summary: String(r.reason),
        },
  );
  const succeeded = flat.filter((f) => f.ok).length;

  return {
    ok: succeeded === targets.length,
    targets: targets.length,
    succeeded,
    failed: targets.length - succeeded,
    durationMs: Date.now() - t0,
    flushedPromptCache: true,
    results: flat,
  };
}
