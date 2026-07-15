/**
 * /api/journal/convergence · ADR-0013 · Phase D
 *
 * Owner-only · read + manual-trigger + dismiss convergence candidates.
 * Confirmation flows through POST /api/journal/threads (different
 * route · this one is for the candidate lifecycle).
 *
 *   GET     /api/journal/convergence            → ConvergenceCandidateRow[]
 *   POST    /api/journal/convergence            → run scan NOW (manual)
 *   DELETE  /api/journal/convergence?hash=...   → soft-delete by clusterHash
 *
 * POST · added 2026-05-18 PM follow-up · was missing from initial
 * Phase D ship · operator had to wait for nightly 22:00 UTC cron
 * to see any candidates · now they can trigger on demand from the
 * ThreadRadar "scan now" button + see immediate result. Same scan
 * the Inngest cron runs · returns telemetry so the UI can show
 * how many entries were scanned + how many candidates found.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { ServiceError } from "@/lib/utils/service-error";
import { logger as rootLogger } from "@/lib/logger";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import {
  dismissCandidate,
  listConvergenceCandidates,
} from "@/lib/services/journal-threads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Manual scan can take ~30-60s for a busy 14-day window · raise
// max-duration so the operator doesn't get a 504 mid-scan.
export const maxDuration = 90;

const log = rootLogger.withSurface("api/journal/convergence");

export async function GET(req: Request) {
  try {
    await requireSession(req);
    const data = await listConvergenceCandidates();
    return NextResponse.json({ data });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    log.error("candidates_list_failed", { error: sanitizeError(err) });
    return NextResponse.json(
      { error: sanitizeError(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    await requireSession(req);
    // Convergence-safety (audit 2026-07-15) · this is the most
    // expensive AI path in the journal feature (gather + embedding
    // backfill + per-candidate name-gen, maxDuration 90s) and it had
    // NO rate limit while the far cheaper capture route did.
    const limited = checkAiRateLimit(req);
    if (limited) return limited;
    // Dynamic import so the heavy convergence module + AI provider
    // chain only load when an operator actually triggers a scan ·
    // the GET path stays light-weight.
    const { runConvergenceScan } = await import(
      "@/lib/services/journal-convergence"
    );
    const result = await runConvergenceScan();
    log.info("manual_scan_triggered", result);
    return NextResponse.json({
      ok: true,
      ranAt: new Date().toISOString(),
      ...result,
    });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: err.status },
      );
    }
    log.error("manual_scan_failed", { error: sanitizeError(err) });
    return NextResponse.json(
      { ok: false, error: sanitizeError(err) },
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
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    log.error("candidate_dismiss_failed", { error: sanitizeError(err) });
    return NextResponse.json(
      { error: sanitizeError(err) },
      { status: 500 },
    );
  }
}
