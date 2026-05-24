/**
 * /api/cron/extract-knowledge · v10.0.371
 *
 * Nightly extraction of factual domain knowledge from yesterday's
 * assistant messages. Per /bdistill-knowledge-extraction skill.
 *
 * Fold target · mega-evening · runs after consolidate, before brain-
 * intelligence (so the new facts are available for the wisdom-distiller
 * to potentially promote into principles).
 *
 * Auth · CRON_SECRET bearer.
 */

import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";
import { runDomainKnowledgeExtraction } from "@/lib/brain/domain-knowledge-extractor";

export const maxDuration = 120;

export async function GET(req: Request) {
  // 2026-05-24 · Wave X.e · timing-safe auth via shared `requireCronAuth`.
  try {
    requireCronAuth(req);
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  try {
    const report = await runDomainKnowledgeExtraction();
    return NextResponse.json({
      ok: true,
      ...report,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message?.slice(0, 200) ?? "extraction failed" },
      { status: 500 },
    );
  }
}
