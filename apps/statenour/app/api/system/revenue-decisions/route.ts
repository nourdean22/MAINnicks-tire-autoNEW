/**
 * GET /api/system/revenue-decisions · v10.0.526 · Arc C · Feature 1
 *
 * Lists the last 30 days of revenue-moves (drafted by the daily cron)
 * with their decision status. Source for the future Ultron cockpit
 * tile that surfaces pending operator approvals.
 *
 * Returns:
 *   { date · ISO ET-day-key,
 *     counts · { pending, approved, rejected, total },
 *     moves · MoveRow[] · descending createdAt }
 *
 * Auth: owner — same gate as /api/system/cost-slo (cockpit-tier
 * telemetry stays behind the operator session).
 *
 * Why a separate surface from the chat tool (getPendingRevenueMoves):
 * the chat tool answers "what's pending RIGHT NOW" · this route returns
 * the historical view (decided + pending) for the dashboard.
 */

import { apiHandler } from "@/lib/utils/http";
import {
  etDateKey,
  listMovesSince,
} from "@/lib/services/revenue-decision-channel";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const daysParam = Number(url.searchParams.get("days") ?? "30");
    const days = Number.isFinite(daysParam)
      ? Math.min(90, Math.max(1, Math.floor(daysParam)))
      : 30;

    const moves = await listMovesSince(days);
    const counts = {
      pending: 0,
      approved: 0,
      rejected: 0,
      total: moves.length,
    };
    for (const m of moves) {
      counts[m.status] += 1;
    }

    return {
      date: etDateKey(),
      windowDays: days,
      counts,
      moves: moves.map((m) => ({
        date: m.date,
        moveIndex: m.moveIndex,
        status: m.status,
        createdAt: m.createdAt,
        decidedAt: m.decidedAt,
        what: m.move.what,
        why: m.move.why,
        expectedImpact: m.move.expectedImpact,
        oneWayDoor: m.move.oneWayDoor,
        wisdomCited: m.move.wisdomCited,
      })),
    };
  },
  { auth: "owner" },
);
