/**
 * GET /api/system/fleet-truth (NL-3) — the one-screen cross-app
 * liveness answer: statenour capability artifacts (spine-7 probes) +
 * nickstire health/schema-guard/self-healing, in the shared
 * @nour/utils/contracts vocabulary. Operator-private: this aggregates
 * operational internals across both businesses.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { getFleetTruth } from "@/lib/observability/fleet-truth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Auth: requireSession invoked below
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const truth = await getFleetTruth();
  return NextResponse.json(truth);
}
