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
import { runDomainKnowledgeExtraction } from "@/lib/brain/domain-knowledge-extractor";

export const maxDuration = 120;

function authorizeCron(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return auth === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
