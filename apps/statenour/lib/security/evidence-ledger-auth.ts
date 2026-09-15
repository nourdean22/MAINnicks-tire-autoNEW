/**
 * Reality Ledger door auth — the pure decision, next-auth-free so tests import
 * the REAL function (lib/auth-guard.ts pulls in `@/auth`, which the vitest
 * suite has to mock wholesale; see tests/setup/auth-guard-mock.ts).
 *
 * Two keys open /api/sync/evidence:
 *   EVIDENCE_LEDGER_KEY — scoped: this door and nothing else. What an unattended
 *                         caller (Night Shift, the proof workflow) should hold.
 *   STATENOUR_SYNC_KEY  — the cross-app bridge key nickstire's server already
 *                         has. Accepted here so its cron keeps posting; it is
 *                         NOT what CI or a headless agent should be handed.
 * Env is read per call (rotation without restart; tests set it per case).
 * Fail closed: no configured key, or no presented key, never authenticates.
 */
import { timingSafeEqual } from "node:crypto";

/** Optional on purpose: `process.env` (an index signature) must be passable as-is. */
export type LedgerKeyEnv = { EVIDENCE_LEDGER_KEY?: string; STATENOUR_SYNC_KEY?: string };

/** x-sync-key first, then Bearer — the same two spellings the bridge door reads. */
export function presentedLedgerKey(headers: Headers): string {
  const direct = headers.get("x-sync-key");
  if (direct) return direct;
  return (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
}

function same(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA); // keep the compare constant-time on a length miss
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Which configured key, if any, the presented one matches. */
export function evidenceDoorAccepts(presented: string, env: LedgerKeyEnv): "ledger" | "bridge" | null {
  const ledger = env.EVIDENCE_LEDGER_KEY?.trim();
  const bridge = env.STATENOUR_SYNC_KEY?.trim();
  if (ledger && same(presented, ledger)) return "ledger";
  if (bridge && same(presented, bridge)) return "bridge";
  return null;
}
