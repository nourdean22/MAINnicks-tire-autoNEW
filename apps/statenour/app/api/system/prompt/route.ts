/**
 * /api/system/prompt — live system-prompt diagnostics.
 *
 * v6 · Returns the actual prompt that WOULD be built right now for a
 * given tier + sample user message. Used by the /system/prompt page so
 * Nour can see:
 *   · which tier slot is active (core / business / content / deep)
 *   · total char count vs the 65k Venice limit
 *   · which sections (engines, knowledge blocks) are firing
 *   · live word count, estimated tokens
 *   · whether the v5.0 Master Content Engine is loaded
 *   · cache hit/miss status
 *
 * Query params:
 *   ?tier=core|business|personal|strategy|full   (default: full)
 *   ?msg=<sample message>                        (default: empty)
 *
 * Auth: session-cookie.
 *
 * Phase B.7b (2026-05-22 · legacy-modernizer REST→tRPC system-pages
 * slice) · the prompt-build + section-breakdown logic moved to the
 * shared `lib/services/system-pages-b.buildPromptDiagnostics` service ·
 * this route AND the new `trpc.system.promptDiagnostics` procedure call
 * the same function · drift impossible. The page reads top-level keys
 * so the route returns the service shape raw via NextResponse.json;
 * apiHandler still provides rate-limit, auth, audit trace IDs,
 * sanitized errors. The route stays mounted as the rollback path.
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/utils/http";
import { buildPromptDiagnostics } from "@/lib/services/system-pages-b";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = apiHandler(
  async (req) => {
    const { searchParams } = new URL(req.url);
    const tierParam = (searchParams.get("tier") ?? "full") as
      | "core"
      | "business"
      | "personal"
      | "strategy"
      | "full";
    const msg = searchParams.get("msg") ?? "";

    const diag = await buildPromptDiagnostics({ tier: tierParam, msg });
    return NextResponse.json(diag);
  },
  { auth: "owner" },
);
