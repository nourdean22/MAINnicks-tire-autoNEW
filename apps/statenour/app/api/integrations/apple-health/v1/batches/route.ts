/**
 * POST /api/integrations/apple-health/v1/batches — canonical inlet
 * (H1, 2026-07-28 late). Client-controlled batch schema: the Shortcuts
 * recipe and any future native bridge post here. Auth: static bearer
 * token (HEALTH_INGEST_TOKEN env — single-operator system; rotate on
 * Railway to revoke). Fail-closed 503 when unset. Timing-safe compare.
 * Privacy: no sample values in logs or error bodies.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  canonicalBatchSchema,
  ingestBatch,
} from "@/lib/services/apple-health-ingest";
import { checkIngestAuth } from "@/lib/security/health-ingest-auth";
import { logger as rootLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const log = rootLogger.withSurface("api/apple-health/batches");
const MAX_BODY_BYTES = 4_000_000;

export async function POST(req: NextRequest): Promise<Response> {
  const denied = checkIngestAuth(req);
  if (denied) return denied;

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "payload too large" }, { status: 413 });
  }

  let parsed;
  try {
    parsed = canonicalBatchSchema.safeParse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "schema validation failed", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 400 },
    );
  }

  try {
    const receipt = await ingestBatch({
      batchId: parsed.data.batchId,
      inlet: "canonical",
      samples: parsed.data.samples,
    });
    return NextResponse.json({ ok: true, ...receipt }, { status: receipt.replayed ? 200 : 201 });
  } catch (e) {
    log.error("canonical_ingest_failed", { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false, error: "ingestion failed" }, { status: 500 });
  }
}
