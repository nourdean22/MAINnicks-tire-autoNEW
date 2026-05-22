// /api/brain/escalations — return the most-recent unresolved escalation.
//
// v7 · BATCH 2F · Apr 28. Powers the chat placeholder + HQ banner +
// any UI surface that wants to know "is something on fire right now?"
//
// v10.0.529.106 · Wave 79 · migrated to apiHandler wrapper. Returns
// raw NextResponse so the existing UI (which reads {escalation: ...})
// continues to see the same top-level shape. Wrapper still adds
// rate limiting, normalized auth, audit trace IDs, error sanitization.
//
// Cross-domain residuals slice (2026-05-22) · the read moved to
// `lib/services/escalations.getLatestEscalation` so this route AND the
// `brain.escalations` tRPC procedure call the SAME function · drift
// structurally impossible.

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/utils/http";
import { getLatestEscalation } from "@/lib/services/escalations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = apiHandler(
  async () => {
    const { escalation } = await getLatestEscalation();
    return NextResponse.json({ escalation });
  },
  { auth: "owner" },
);
