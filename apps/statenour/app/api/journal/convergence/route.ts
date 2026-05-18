/**
 * /api/journal/convergence · ADR-0013 · Phase D
 *
 * Owner-only · read + dismiss convergence candidates the nightly
 * cron wrote. Confirmation flows through POST /api/journal/threads.
 *
 *   GET     /api/journal/convergence            → ConvergenceCandidateRow[]
 *   DELETE  /api/journal/convergence?hash=...   → soft-delete by clusterHash
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { logger as rootLogger } from "@/lib/logger";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import {
  dismissCandidate,
  listConvergenceCandidates,
} from "@/lib/services/journal-threads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

const log = rootLogger.withSurface("api/journal/convergence");

export async function GET(req: Request) {
  try {
    await requireSession(req);
    const data = await listConvergenceCandidates();
    return NextResponse.json({ data });
  } catch (err) {
    log.error("candidates_list_failed", { error: sanitizeError(err) });
    return NextResponse.json(
      { error: sanitizeError(err) },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    await requireSession(req);
    const url = new URL(req.url);
    const hash = url.searchParams.get("hash");
    if (!hash) {
      return NextResponse.json(
        { error: "hash query param required" },
        { status: 400 },
      );
    }
    const result = await dismissCandidate(hash);
    return NextResponse.json(result);
  } catch (err) {
    log.error("candidate_dismiss_failed", { error: sanitizeError(err) });
    return NextResponse.json(
      { error: sanitizeError(err) },
      { status: 500 },
    );
  }
}
