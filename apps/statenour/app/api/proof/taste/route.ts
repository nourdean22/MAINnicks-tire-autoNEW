/**
 * POST /api/proof/taste — record one pairwise taste judgment.
 *
 * Owner-only: a judgment is Nour's, by definition. Body is
 * TasteJudgmentInput (lib/services/reality-ledger.ts); the row is written
 * verbatim and a compact mirror lands in brain_memories at OPERATOR trust.
 * GET returns the reason-code vocabulary so a UI or an agent proposes
 * codes from the same list.
 */
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { recordTasteJudgment, TASTE_REASON_CODES } from "@/lib/services/reality-ledger";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => ({ reasonCodes: TASTE_REASON_CODES }), { auth: "owner" });

export const POST = apiHandler(
  async (req) => {
    const body = await readRequestJson<unknown>(req);
    const row = await recordTasteJudgment(body);
    return { ok: true, id: row.id, decidedAt: row.decidedAt };
  },
  { auth: "owner" },
);
