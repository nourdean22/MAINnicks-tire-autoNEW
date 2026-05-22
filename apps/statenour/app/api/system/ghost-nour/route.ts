import { apiHandler } from "@/lib/utils/http";
import { z } from "zod";
import {
  runGhostNourPredict,
  GhostNourPredictError,
} from "@/lib/services/ghost-nour-predict";

/**
 * POST /api/system/ghost-nour — predict what past-Nour would have done.
 *
 * Given a situation/decision text, find the most similar past decisions
 * and surface:
 *   · top N matches (MasteryDecision rows ranked by keyword similarity)
 *   · frequency breakdown: "you've faced something like this N times"
 *   · choice distribution: what past-Nour picked in those
 *   · outcome summary: avg grade on past choices
 *   · ghost recommendation: the highest-rated historical choice
 *
 * Also GET /api/system/ghost-nour?list=recent — returns recent
 * decisions that have no actualOutcome (candidates for review) so the
 * UI can offer "run ghost on this" for pending decisions.
 *
 * straggler-pages REST→tRPC slice (2026-05-22) · the prediction logic
 * moved to lib/services/ghost-nour-predict.ts so this route and the
 * new `system.ghostNourPredict` tRPC procedure call ONE function ·
 * drift impossible. This route is the thin REST shell that stays
 * mounted.
 */

const PostSchema = z.object({
  situation: z.string().min(3).max(2000),
  limit: z.number().int().min(1).max(20).default(5),
});

export const POST = apiHandler(async (req) => {
  const body = PostSchema.parse(await req.json());
  try {
    return await runGhostNourPredict(body);
  } catch (err) {
    if (err instanceof GhostNourPredictError) {
      throw Object.assign(new Error(err.message), {
        status: 400,
        code: err.code,
      });
    }
    throw err;
  }
}, { auth: "owner" }); // v9.1.14 · POST runs analysis on decision history

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const mode = url.searchParams.get("list") ?? "recent";

  if (mode === "recent") {
    // Phase Y.3 (2026-05-18 PM) · delegates to shared service · same
    // function the `trpc.system.ghostNourCandidates` procedure calls ·
    // drift impossible.
    const { readGhostNourCandidates } = await import("@/lib/services/ghost-nour");
    const rows = await readGhostNourCandidates();
    return { mode: "recent", candidates: rows };
  }

  throw Object.assign(new Error(`unknown list mode: ${mode}`), { status: 400 });
}, { auth: "owner" }); // v9.1.14 · was leaking decision history
