/**
 * GET /api/customer-360/[customerId] · Wave-200 Phase 6 (2026-05-17)
 *
 * Owner-only · returns the full Customer 360 payload for one customer:
 *   · customer record (from nickstire via bridge)
 *   · timeline (invoices · estimates · ALG estimates · callbacks)
 *   · inferred preferences (from BrainMemory · may be stale or null
 *     if the daily Inngest preference cron hasn't run yet for this
 *     customer)
 *
 * Bridge fallback: if the nickstire bridge is down or the
 * `customer_detail` query returns an error, we still return the
 * preferences (if cached in BrainMemory from a prior successful run)
 * so the UI can render something useful. Response carries
 * `bridgeStatus: "ok" | "degraded" | "down"` so the client can
 * surface the right banner.
 *
 * Performance: the call holds a 12-second timeout via queryNick · the
 * preferences read is a single Postgres query (~10ms). Worst case
 * end-to-end: ~12.1s on bridge timeout · fast path: ~200ms.
 *
 * See:
 *   · docs/adr/0008-customer-360-predictive-brain.md
 *   · apps/statenour/lib/brain/customer-preferences.ts
 *   · apps/statenour/lib/nickstire/query.ts
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";
import { queryNick } from "@/lib/nickstire/query";
import {
  getCustomerPreferences,
  inferCustomerPreferences,
  persistCustomerPreferences,
  type CustomerDetailInput,
  type CustomerPreferences,
} from "@/lib/brain/customer-preferences";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

interface BridgeOk {
  customer: CustomerDetailInput["customer"];
  timeline: CustomerDetailInput["timeline"];
  counts: Record<string, number>;
}

interface BridgeErr {
  error: string;
  statusCode?: number;
}

function isBridgeOk(value: unknown): value is BridgeOk {
  return (
    typeof value === "object" &&
    value !== null &&
    "customer" in value &&
    "timeline" in value
  );
}

interface RouteContext {
  params: Promise<{ customerId: string }>;
}

export async function GET(req: Request, context: RouteContext) {
  try {
    await requireSession(req);
    const { customerId } = await context.params;
    if (!customerId) {
      return NextResponse.json(
        { error: "customerId required" },
        { status: 400 },
      );
    }

    // ── 1 · query bridge for fresh detail ─────────────────────────
    const bridgeResp = await queryNick<BridgeOk>("customer_detail", {
      customerId,
    });

    let detail: BridgeOk | null = null;
    let bridgeStatus: "ok" | "degraded" | "down" = "down";
    if (bridgeResp && "data" in bridgeResp && isBridgeOk(bridgeResp.data)) {
      detail = bridgeResp.data;
      bridgeStatus = "ok";
    } else {
      const err = bridgeResp as BridgeErr;
      bridgeStatus = err.statusCode && err.statusCode < 500 ? "degraded" : "down";
    }

    // ── 2 · read cached preferences ───────────────────────────────
    const cachedPrefs = await getCustomerPreferences(customerId);

    // ── 3 · recompute preferences if we have fresh detail ─────────
    let prefs: CustomerPreferences | null = cachedPrefs;
    if (detail) {
      const fresh = inferCustomerPreferences(detail);
      // Fire-and-forget persist · we return the fresh prefs regardless
      void persistCustomerPreferences(fresh);
      prefs = fresh;
    }

    return NextResponse.json({
      customerId,
      bridgeStatus,
      detail, // may be null if bridge is down · UI handles
      preferences: prefs, // may be cached if bridge is down · null if never inferred
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status },
      );
    }
    return NextResponse.json(
      {
        error: "customer_360_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
