/**
 * GET /api/proof/timeline — the Repo Time Machine: one row per JUDGED commit
 * (proof.run / proof.holdout / proof.episode_failed grouped on the commit the
 * live site actually served), newest first, with deltas against the previous
 * judged commit. Owner-only; read-only. ?limit=N (1–50, default 10).
 */
import { apiHandler } from "@/lib/utils/http";
import { proofTimeline } from "@/lib/services/proof-timeline";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async (req: Request) => {
    const raw = Number(new URL(req.url).searchParams.get("limit") ?? "10");
    const limit = Number.isFinite(raw) ? Math.min(50, Math.max(1, Math.trunc(raw))) : 10;
    return proofTimeline(limit);
  },
  { auth: "owner" },
);
