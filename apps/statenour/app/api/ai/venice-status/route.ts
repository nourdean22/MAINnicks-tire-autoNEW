import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { probeVeniceStatus } from "@/lib/services/venice-status";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/venice-status — Live Venice API status + balance
 *
 * Makes a minimal API call to Venice to read response headers:
 * - USD balance, DIEM balance
 * - Rate limits (remaining requests, tokens)
 * - Model info, deprecation warnings
 * - API version
 *
 * v10.0.44 — auth gate. Pre-fix any caller could read the live
 * Venice account balance + rate-limit state. Owner-only now.
 *
 * Cross-domain residuals slice (2026-05-22) · the probe logic moved to
 * `lib/services/venice-status.probeVeniceStatus` so this route AND the
 * `system.veniceStatus` tRPC procedure call the SAME function · drift
 * structurally impossible. The HTTP status mapping is preserved here
 * (the service returns a plain `{ ok, error }` shape · this route still
 * varies the status code for any direct REST consumer).
 */
export async function GET(req: Request) {
  await requireSession(req);
  const status = await probeVeniceStatus();
  if (!status.ok) {
    const code = status.error === "VENICE_API_KEY not set" ? 503 : 500;
    return NextResponse.json(status, { status: code });
  }
  return NextResponse.json(status);
}
