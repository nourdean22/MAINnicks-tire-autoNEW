/**
 * Evidence ledger client — nickstire's outbound half of the Reality Ledger
 * that lives in statenour (`POST /api/sync/evidence`, sync-key auth).
 *
 * Two record kinds, both append-only on the far side:
 *   · RealityEvent  — something observed (an experiment verdict, a probe
 *                     failure, a ShopState transition), with the objects it
 *                     belongs to and where it came from.
 *   · EvidenceClaim — an interpretation with an evidence grade (H0..H5) and
 *                     the events it rests on.
 *
 * Best-effort by design: the ledger is a consumer of the shop's truth, never
 * a dependency of it. A dead statenour must not fail a cron here, so every
 * path returns false instead of throwing, and nothing waits longer than 5s.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("evidence-ledger");

export type EvidenceGrade = "H0" | "H1" | "H2" | "H3" | "H4" | "H5";

export interface RealityEventInput {
  eventType: string;
  observedAt?: string;
  objects: Array<{ type: string; id: string; role?: string }>;
  source: { system: string; version?: string; uri?: string };
  experiment?: { experimentId: string; variantId?: string; contractHash?: string };
  quality?: "observed" | "derived" | "inferred";
  privacy?: "public" | "internal";
  payload?: Record<string, unknown>;
}

export interface EvidenceClaimInput {
  claimText: string;
  grade: EvidenceGrade;
  hypothesisId?: string;
  goalId?: string;
  contractHash?: string;
  sourceEventKeys?: string[];
  confidence?: number;
  disposition?: "supported" | "refuted" | "inconclusive";
  createdBy?: "agent" | "cron" | "operator";
}

function endpoint(): { url: string; key: string } | null {
  const base = process.env.STATENOUR_SYNC_URL?.replace(/\/+$/, "");
  const key = process.env.STATENOUR_SYNC_KEY;
  if (!base || !key) return null;
  return { url: `${base}/api/sync/evidence`, key };
}

export async function postToEvidenceLedger(body: { events?: RealityEventInput[]; claims?: EvidenceClaimInput[] }): Promise<boolean> {
  const ep = endpoint();
  if (!ep) {
    log.debug("evidence ledger not configured (STATENOUR_SYNC_URL / STATENOUR_SYNC_KEY) — skipped");
    return false;
  }
  try {
    const res = await fetch(ep.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-key": ep.key },
      body: JSON.stringify({ ...body, sentAt: new Date().toISOString(), sender: "nickstire" }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      log.warn("evidence ledger rejected the post", { status: res.status });
      return false;
    }
    return true;
  } catch (err) {
    log.warn("evidence ledger unreachable", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
