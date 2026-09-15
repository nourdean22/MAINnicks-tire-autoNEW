/**
 * /api/sync/evidence — the Reality Ledger's ingest and read door.
 *
 * POST  { events?: RealityEvent[], claims?: EvidenceClaim[], sender }
 *       Auth: x-sync-key / Bearer — EVIDENCE_LEDGER_KEY (the scoped key for
 *       unattended callers: the proof workflow, the Night Shift script) or
 *       STATENOUR_SYNC_KEY (nickstire's cron, which already holds the bridge
 *       key). The scoped key opens no other route. Partial batches land; the
 *       receipt names every rejected row by index.
 * GET   ?limit=50  Recent claims + events, newest first — what the Night
 *       Shift prompt reads before choosing a hypothesis. Same auth.
 */
import { evidenceHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { recordEvidenceBatch, type EvidenceProducer } from "@/lib/services/reality-ledger";
import { evidenceDoorAccepts, presentedLedgerKey } from "@/lib/security/evidence-ledger-auth";

export const dynamic = "force-dynamic";

/**
 * Which door the request came through decides how much its claims may be
 * believed (PRODUCER_CEILING) and who they are recorded as (PRODUCER_AUTHOR).
 * Derived from the SAME comparison the guard already ran — never from the body.
 */
function producerOf(req: Request): EvidenceProducer | null {
  const door = evidenceDoorAccepts(presentedLedgerKey(req.headers), {
    EVIDENCE_LEDGER_KEY: process.env.EVIDENCE_LEDGER_KEY,
    STATENOUR_SYNC_KEY: process.env.STATENOUR_SYNC_KEY,
  });
  return door; // "ledger" | "bridge" | null (null cannot survive requireEvidenceAuth, but never assume)
}

export const POST = evidenceHandler(async (req) => {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    return { ok: false, error: "Content-Type must be application/json" };
  }
  const producer = producerOf(req);
  if (!producer) return { ok: false, error: "no evidence producer resolved for this credential" };
  const body = await req.json();
  const receipt = await recordEvidenceBatch(body, { producer });
  return { ok: receipt.rejected.length === 0, producer, ...receipt };
});

export const GET = evidenceHandler(async (req) => {
  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
  const [claims, events] = await Promise.all([
    prisma.evidenceClaim.findMany({ orderBy: { createdAt: "desc" }, take: limit }),
    prisma.realityEvent.findMany({ orderBy: { observedAt: "desc" }, take: limit }),
  ]);
  return { claims, events, generatedAt: new Date().toISOString() };
});
