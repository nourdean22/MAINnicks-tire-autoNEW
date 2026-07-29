/**
 * POST /api/integrations/apple-health/v1/hae — Health Auto Export inlet
 * (H1/H3, 2026-07-28 late). HAE is the day-one bridge: it reads
 * HealthKit ON-DEVICE and posts its own JSON shape directly here — no
 * third-party server ever holds the data. This route transforms the
 * HAE payload into canonical samples (pure function, unit-tested) and
 * derives a deterministic batchId from the payload hash, so HAE's
 * retries and repeat automations dedupe instead of duplicating.
 * Same bearer auth + caps as the canonical inlet.
 */
import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  ingestBatch,
  transformHaePayload,
} from "@/lib/services/apple-health-ingest";
import { checkIngestAuth } from "@/lib/security/health-ingest-auth";
import { logger as rootLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const log = rootLogger.withSurface("api/apple-health/hae");
const MAX_BODY_BYTES = 8_000_000;

export async function POST(req: NextRequest): Promise<Response> {
  const denied = checkIngestAuth(req);
  if (denied) return denied;

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "payload too large" }, { status: 413 });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ ok: false, error: "unreadable body" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const samples = transformHaePayload(payload);
  if (samples.length === 0) {
    // Loud, not silent: an empty transform on a non-empty payload means
    // the HAE format drifted or the metric selection is empty.
    log.warn("hae_transform_empty", { bytes: raw.length });
    return NextResponse.json(
      { ok: false, error: "no recognizable samples in payload — check HAE metric selection / format (JSON required)" },
      { status: 422 },
    );
  }

  const batchId = `hae-${createHash("sha256").update(raw).digest("hex").slice(0, 40)}`;
  try {
    const receipt = await ingestBatch({ batchId, inlet: "hae", samples });
    return NextResponse.json({ ok: true, ...receipt }, { status: receipt.replayed ? 200 : 201 });
  } catch (e) {
    log.error("hae_ingest_failed", { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false, error: "ingestion failed" }, { status: 500 });
  }
}
