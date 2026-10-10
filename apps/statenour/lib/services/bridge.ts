/**
 * Bridge client — fetches shop snapshot from Nick's Admin (nickstire.org).
 * Server-side only. Bridge key stays on the server.
 */

import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/bridge");

export interface ShopSnapshot {
  timestamp: string;
  // null = not measured / the read failed (live-query fallback) -- never a 0.
  bookings: {
    todayCount: number | null;
    newCount: number | null;
    confirmedCount: number | null;
    completedCount: number | null;
  };
  leads: {
    totalActive: number | null;
    uncontactedCount: number | null;
    urgentCount: number | null;
    thisWeek: number | null;
  };
  callbacks: {
    pendingCount: number | null;
    totalCount: number | null;
    completedCount: number | null;
  };
  revenue: {
    todayEstimate: number | null;
    weekEstimate: number | null;
  };
  syncHealth: {
    overall: "healthy" | "degraded" | "down";
    services: Record<string, string>;
  };
  chat: {
    totalSessions: number | null;
    thisWeek: number | null;
  };
  recentActivity: {
    lastBookingAt: string | null;
    lastLeadAt: string | null;
  };
}

// Resolve the bridge URL + key the SAME way as the canonical queryNick
// client (lib/nickstire/query.ts) so the two bridge clients can't drift.
// STATENOUR_SYNC_KEY is the live Railway key — reading only BRIDGE_API_KEY
// here meant the fast dedicated bridge endpoints were skipped (snapshot fell
// through to the slow 4-query batch; health returned null entirely).
function resolveBridgeConfig(): { url: string | undefined; key: string | undefined } {
  return {
    url:
      process.env.NICKSTIRE_URL ||
      process.env.NICKS_ADMIN_URL ||
      process.env.NICKSTIRE_BRIDGE_URL,
    key: process.env.BRIDGE_API_KEY || process.env.STATENOUR_SYNC_KEY,
  };
}

export async function fetchShopSnapshot(): Promise<ShopSnapshot | null> {
  const { url, key } = resolveBridgeConfig();

  // Try live bridge first
  // v10.0.505 · ADR-0011 slow-path audit · added 4s timeout so a stalled
  // nickstire bridge can't hang /api/command/data for 10-30s. Earlier
  // logs showed the route taking 10.4s when this fetch was the
  // bottleneck. AbortSignal.timeout fires AbortError on miss · existing
  // catch handles it via "snapshot_fetch_failed" log.
  if (url && key) {
    try {
      const res = await fetch(`${url}/api/bridge/shop-snapshot`, {
        headers: { "X-Bridge-Key": key },
        next: { revalidate: 60 },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) return await res.json();
      log.warn("snapshot_http_error", { status: res.status });
    } catch (err) {
      log.warn("snapshot_fetch_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Fallback: pull LIVE data from nickstire query API
  try {
    const { queryNickBatch, readBridge } = await import("@/lib/nickstire/query");
    const live = await queryNickBatch([
      { query: "revenue_today" },
      { query: "leads_urgent" },
      { query: "bookings_today" },
      { query: "callbacks_pending" },
    ]);
    // A failed read (transport, unknown query, or a 200 carrying `data.error`)
    // is UNKNOWN: its counts are null and syncHealth says degraded. Before
    // 2026-10-10 a `{ error: "No DB" }` body was truthy "data" and rendered as
    // 0 leads / 0 callbacks under a hard-coded "healthy".
    const reads = {
      revenue_today: readBridge<{ totalDollars?: number }>(live.revenue_today),
      leads_urgent: readBridge<{ count?: number }>(live.leads_urgent),
      bookings_today: readBridge<{ count?: number }>(live.bookings_today),
      callbacks_pending: readBridge<{ count?: number }>(live.callbacks_pending),
    };
    const services: Record<string, string> = {};
    for (const [name, r] of Object.entries(reads)) {
      services[name] = r.status === "ok" ? "ok" : `unknown: ${r.reason}`;
    }
    const count = (r: (typeof reads)[keyof typeof reads]): number | null =>
      r.status === "ok" && typeof (r.data as { count?: unknown })?.count === "number"
        ? ((r.data as { count: number }).count)
        : null;
    const okCount = Object.values(reads).filter((r) => r.status === "ok").length;
    if (okCount > 0) {
      const bk = count(reads.bookings_today);
      const leads = count(reads.leads_urgent);
      const cb = count(reads.callbacks_pending);
      const rev = reads.revenue_today.status === "ok" ? reads.revenue_today.data : null;
      return {
        timestamp: new Date().toISOString(),
        bookings: {
          todayCount: bk,
          newCount: bk,
          confirmedCount: null,
          completedCount: null,
        },
        leads: {
          totalActive: leads,
          uncontactedCount: leads,
          urgentCount: leads,
          thisWeek: null,
        },
        callbacks: {
          pendingCount: cb,
          totalCount: cb,
          completedCount: null,
        },
        revenue: {
          // null, not 0, when the revenue_today query returned nothing: the
          // Command Surface falls through to the last pushed reading, and a
          // failed bridge read can no longer show as a $0 day (2026-09-02).
          todayEstimate: typeof rev?.totalDollars === "number" ? rev.totalDollars : null,
          weekEstimate: null,
        },
        syncHealth: { overall: okCount === 4 ? "healthy" : "degraded", services },
        chat: { totalSessions: null, thisWeek: null },
        recentActivity: { lastBookingAt: null, lastLeadAt: null },
      };
    }
    log.warn("live_query_fallback_unknown", { services });
  } catch (err) {
    log.warn("live_query_fallback_failed", { error: err instanceof Error ? err.message : String(err) });
  }

  return null;
}

export async function fetchShopHealth(): Promise<{ status: string } | null> {
  const { url, key } = resolveBridgeConfig();

  if (!url || !key) return null;

  try {
    const res = await fetch(`${url}/api/bridge/health`, {
      headers: { "X-Bridge-Key": key },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
