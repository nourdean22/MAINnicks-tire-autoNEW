/**
 * GET / POST /api/mit · v10.0.300 · daily Most Important Task slot
 * for Ultron HQ.
 *
 * One MIT per day · the operator's binary daily-focus anchor.
 * Distinct from todo lists · only ONE thing matters today.
 *
 * Persisted as brainMemory (category="daily_mit", key=YYYY-MM-DD)
 * so:
 *   · Auto-clears at midnight (next day = new key = empty MIT)
 *   · Historical record · which days had what MIT (audit later)
 *   · Decays via the brain-cycle along with everything else
 *
 * GET returns { key, text, updatedAt } · text is null if not set today.
 * POST { text } sets/updates. Empty/blank text clears today's MIT.
 *
 * Phase B.6a (2026-05-22) · the GET/POST handler bodies were extracted
 * into `lib/services/mit.ts` (getMit / setMit) so the new
 * `operator.mit` / `operator.setMit` tRPC procedures call the SAME
 * functions · drift impossible. This route stays mounted as the
 * rollback path.
 */
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { getMit, setMit } from "@/lib/services/mit";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  return getMit();
}, { auth: "owner" });

export const POST = apiHandler(async (req) => {
  const body = (await readRequestJson(req)) as { text?: string };
  return setMit(body.text ?? "");
}, { auth: "owner" });
