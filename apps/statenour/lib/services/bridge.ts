/**
 * Bridge client — fetches shop snapshot from Nick's Admin (nickstire.org).
 * Server-side only. Bridge key stays on the server.
 */

import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/bridge");

export interface ShopSnapshot {
  timestamp: string;
  bookings: {
    todayCount: number;
    newCount: number;
    confirmedCount: number;
    completedCount: number;
  };
  leads: {
    totalActive: number;
    uncontactedCount: number;
    urgentCount: number;
    thisWeek: number;
  };
  callbacks: {
    pendingCount: number;
    totalCount: number;
    completedCount: number;
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
    totalSessions: number;
    thisWeek: number;
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
    key: process.env.STATENOUR_SYNC_KEY || process.env.BRIDGE_API_KEY,
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
    const { queryNickBatch } = await import("@/lib/nickstire/query");
    const live = await queryNickBatch([
      { query: "revenue_today" },
      { query: "leads_urgent" },
      { query: "bookings_today" },
      { query: "callbacks_pending" },
    ]);
    const rev = (live.revenue_today as any)?.data;
    const leads = (live.leads_urgent as any)?.data;
    const bk = (live.bookings_today as any)?.data;
    const cb = (live.callbacks_pending as any)?.data;
    if (rev || leads || bk || cb) {
      return {
        timestamp: new Date().toISOString(),
        bookings: {
          todayCount: bk?.count ?? 0,
          newCount: bk?.count ?? 0,
          confirmedCount: 0,
          completedCount: 0,
        },
        leads: {
          totalActive: leads?.count ?? 0,
          uncontactedCount: leads?.count ?? 0,
          urgentCount: leads?.count ?? 0,
          thisWeek: 0,
        },
        callbacks: {
          pendingCount: cb?.count ?? 0,
          totalCount: cb?.count ?? 0,
          completedCount: 0,
        },
        revenue: {
          todayEstimate: rev?.totalDollars ?? 0,
          weekEstimate: null,
        },
        syncHealth: { overall: "healthy" as const, services: {} },
        chat: { totalSessions: 0, thisWeek: 0 },
        recentActivity: { lastBookingAt: null, lastLeadAt: null },
      };
    }
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
