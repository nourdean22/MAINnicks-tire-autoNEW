import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { loadEnvConfig } from "@next/env";
// v10.0.26 — hoist the slow-query tracker import. Pre-v10.0.26 the
// query event listener did `import("@/lib/db/slow-query-tracker")` per
// slow-query event — works (Node caches resolved modules) but adds a
// microtask + risks edge-runtime tree-shaking dropping the module.
// Static import keeps it in the dep graph + zero per-event overhead.
import { recordSlowQuery } from "@/lib/db/slow-query-tracker";

loadEnvConfig(process.cwd());

declare global {
  var prisma: PrismaClient | undefined;
  /** Sliding-window map of normalized query shape → recent timestamps (N+1 detection) */
  var __queryWindow: Map<string, number[]> | undefined;
  /** Normalized query shape → timestamp of the last N+1 warning, for cooldown */
  var __nPlusOneLastWarn: Map<string, number> | undefined;
  /**
   * Simple cumulative counter used by apiHandler to log how many DB
   * queries a single request issued. Kept SEPARATE from the N+1
   * sliding window because they answer different questions:
   *   - __queryCount: "how many queries did this one request run?"
   *   - __queryWindow: "did the same query SHAPE repeat N times fast?"
   * apiHandler calls resetQueryCount() at the top of each request.
   */
  var __queryCount: number | undefined;
}

// ── Config (tuned for Neon free tier) ──────────────────────────────────
// Neon remote Postgres has ~130-180ms baseline round-trip from dev machine.
// 500ms = actually slow query worth investigating; below that is network latency.
const SLOW_QUERY_THRESHOLD_MS = 500;

// REAL N+1 DETECTION (Apr 15):
// The old counter just tracked total queries since dev-server start and
// fired "N+1 detected: 25 queries in this request" once per server
// lifetime — a cumulative global that had nothing to do with N+1. This
// version uses a sliding window: per normalized query SHAPE, record the
// timestamp of each fire; when the same shape repeats ≥ N_PLUS_ONE_MIN_REPEATS
// times within N_PLUS_ONE_WINDOW_MS, that's an actual N+1 signal and we
// warn once per shape per cooldown.
const N_PLUS_ONE_WINDOW_MS = 500; // burst window
const N_PLUS_ONE_MIN_REPEATS = 10; // threshold inside the window
const N_PLUS_ONE_COOLDOWN_MS = 5_000; // silence repeat warnings for the same shape

// Suppress quiet mode: set to true to silence all per-query logs in dev.
const QUIET_QUERY_LOG = process.env.QUIET_DB_LOG === "1";

/**
 * Normalize a Prisma query string into a SHAPE — same statement
 * structure regardless of parameter values. Prisma already
 * parameterizes ($1, $2, ...) so most of the work is just collapsing
 * whitespace + stripping known per-call noise.
 *
 * Kept cheap — this runs on every query event.
 */
function normalizeQueryShape(query: string): string {
  return query
    .replace(/\s+/g, " ")
    .replace(/"public"\./g, "")
    .replace(/\$\d+/g, "$?") // any parameter index → $?
    .trim()
    .slice(0, 240);
}

// Raw SQL text is only emitted when DEBUG_SQL=1 is explicitly set. By
// default the dev slow-query/N+1 logs carry the normalized SHAPE
// ($?-parameterized, "public". stripped, no literals) so ad-hoc predicate
// text never leaks into shared dev consoles, screen recordings, or pasted
// incident notes. Prisma already parameterizes values, so the shape is the
// useful signal anyway; raw text is opt-in for deep debugging only.
const RAW_SQL_LOG = process.env.DEBUG_SQL === "1";
function sqlForLog(query: string, max = 120): string {
  return (RAW_SQL_LOG ? query : normalizeQueryShape(query)).slice(0, max);
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });

  // v10.0.18 — emit "query" events in BOTH dev + prod so the slow-query
  // tracker can populate /system/slow-queries. Dev keeps the verbose
  // sliding-window N+1 detector + colored stdout; prod runs ONLY the
  // slow-query record path (cheap — bounded memory + structured log).
  const client = new PrismaClient({
    adapter,
    log: [
      { emit: "event", level: "query" },
      ...(process.env.NODE_ENV === "development"
        ? [
            { emit: "stdout" as const, level: "warn" as const },
            { emit: "stdout" as const, level: "error" as const },
          ]
        : [{ emit: "stdout" as const, level: "error" as const }]),
    ],
  });

  // ── Production: cheap slow-query telemetry only ──────────────────────
  if (process.env.NODE_ENV !== "development") {
    (client.$on as Function)("query", (e: Prisma.QueryEvent) => {
      const duration = e.duration;
      if (duration > SLOW_QUERY_THRESHOLD_MS) {
        // v10.0.26 — static import; recordSlowQuery is fire-and-forget
        // and never throws (its own try/catch).
        recordSlowQuery(normalizeQueryShape(e.query), duration);
      }
    });
  }

  // ── Query timing + sliding-window N+1 detection ──────────────────────
  if (process.env.NODE_ENV === "development") {
    if (!global.__queryWindow) global.__queryWindow = new Map();
    if (!global.__nPlusOneLastWarn) global.__nPlusOneLastWarn = new Map();

    (client.$on as Function)("query", (e: Prisma.QueryEvent) => {
      const duration = e.duration;

      // Per-request cumulative counter (used by apiHandler logging)
      global.__queryCount = (global.__queryCount ?? 0) + 1;

      // v10.0.18 — feed the slow-query tracker in dev too. Same rolling
      // buffer; surfaces in /system/slow-queries when running locally.
      // v10.0.26 — static import via top-level (no per-event microtask).
      if (duration > SLOW_QUERY_THRESHOLD_MS) {
        recordSlowQuery(normalizeQueryShape(e.query), duration);
      }

      // ── Slow-query log (always useful) ─────────────────────────────
      if (QUIET_QUERY_LOG) {
        if (duration > SLOW_QUERY_THRESHOLD_MS) {
          console.warn(`\x1b[31m⚠ Slow query [${duration}ms]: ${sqlForLog(e.query)}\x1b[0m`);
        }
      } else {
        if (duration > SLOW_QUERY_THRESHOLD_MS) {
          console.warn(`\x1b[31m⚠ Slow query [${duration}ms]: ${sqlForLog(e.query)}\x1b[0m`);
        } else if (duration > 300) {
          // Amber zone — Neon cold connection, informational only
          console.log(`\x1b[33m● Query [${duration}ms]: ${sqlForLog(e.query, 80)}\x1b[0m`);
        }
        // Anything under 300ms is silent — that's normal Neon latency, not noise
      }

      // ── Real N+1 detection (sliding window by query shape) ─────────
      const now = Date.now();
      const shape = normalizeQueryShape(e.query);

      const window = global.__queryWindow!;
      const lastWarn = global.__nPlusOneLastWarn!;

      // Record this fire
      const hits = window.get(shape) ?? [];
      // Drop anything older than the window
      const cutoff = now - N_PLUS_ONE_WINDOW_MS;
      const recent = hits.filter((t) => t >= cutoff);
      recent.push(now);
      window.set(shape, recent);

      // Trim map growth — prune shapes with no recent activity every
      // ~100 query events. Cheap, keeps memory bounded in long dev
      // sessions where thousands of distinct shapes accumulate.
      if (window.size > 200) {
        for (const [k, v] of window) {
          const kRecent = v.filter((t) => t >= cutoff);
          if (kRecent.length === 0) window.delete(k);
          else window.set(k, kRecent);
        }
      }

      // Trigger warning if this shape has repeated enough times in
      // the window AND we haven't warned for this shape recently.
      if (recent.length >= N_PLUS_ONE_MIN_REPEATS) {
        const lastWarnAt = lastWarn.get(shape) ?? 0;
        if (now - lastWarnAt >= N_PLUS_ONE_COOLDOWN_MS) {
          lastWarn.set(shape, now);
          const windowMs = now - recent[0];
          console.warn(
            `\x1b[31m⚠ N+1 detected: "${shape.slice(0, 120)}" fired ${recent.length}× in ${windowMs}ms — consider findMany({ where: { id: { in: [...] } } })\x1b[0m`
          );
        }
      }
    });
  }

  return client;
}

export const prisma = global.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

// ── Retired-model compat shims — REMOVED v11.1 (2026-04-22) ──────────
// The Apr 2026 cleanup eliminated all call sites for 34 retired models
// (commit aae0186 · 250 replacements via codemod). Full repo grep
// confirms 0 callers. The Proxy shim factory + RETIRED_MODELS array
// are gone. `types/prisma-compat.d.ts` is kept for a 48-hour grace
// period so any edge path we missed still typechecks; once that grace
// passes, that file is removable too.
//
// Why this matters: every PrismaClient boot used to install 34 Proxy
// instances. Negligible RAM but real surface area — any accidental
// call to a retired model would silently return empty (invisible bug)
// instead of throwing (loud bug we fix). Removing the shim forces any
// future regression to surface as a TypeError at import time.

// ── Health check ───────────────────────────────────────────────────────
export async function checkDbConnection(): Promise<{ connected: boolean; latency_ms: number }> {
  const start = Date.now();
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return { connected: true, latency_ms: Date.now() - start };
  } catch {
    return { connected: false, latency_ms: Date.now() - start };
  }
}

// ── Per-request query counter helpers (used by lib/utils/http.ts) ──────
// These drive the `queries: N` field in the request completion log line.
// They're a SIMPLE counter — NOT the N+1 detector, which is the
// sliding-window logic inside createPrismaClient above.
export function resetQueryCount(): void {
  global.__queryCount = 0;
}

export function getQueryCount(): number {
  return global.__queryCount ?? 0;
}
