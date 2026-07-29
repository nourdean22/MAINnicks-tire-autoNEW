/**
 * Health-ingest bearer auth (H1, 2026-07-28 late). Static token in
 * HEALTH_INGEST_TOKEN — single-operator system; rotate on Railway to
 * revoke the device. Fail-closed 503 when unset; timing-safe compare.
 * Lives in lib/ (not a route file) because Next's route-type validation
 * rejects extra exports from route.ts.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

export function checkIngestAuth(req: NextRequest): NextResponse | null {
  const expected = (process.env.HEALTH_INGEST_TOKEN ?? "").trim();
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "health ingestion not configured (HEALTH_INGEST_TOKEN unset)" },
      { status: 503 },
    );
  }
  const supplied = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}
