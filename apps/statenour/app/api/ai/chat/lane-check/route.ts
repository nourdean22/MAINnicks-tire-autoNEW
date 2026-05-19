/**
 * POST /api/ai/chat/lane-check
 *
 * Real-time lane correction · returns at most one "Also watching: …"
 * chip the LaneCorrectionChip component renders below an assistant
 * reply. Logic (rule-based · no LLM) lives in
 * `lib/services/chat-lane-check.ts`.
 *
 * Phase GG (2026-05-18 PM) · heavy lifting moved to the shared
 * service so both this REST endpoint AND the
 * `trpc.chat.laneCheck` procedure call the same `checkLane()`
 * function · drift between the two consumers is structurally
 * impossible. Stays mounted for back-compat with any non-tRPC
 * consumer (curl probes, external integrations).
 *
 * Returns 200 even on internal failure · the chip is decoration
 * and should never block chat rendering.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { checkLane } from "@/lib/services/chat-lane-check";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST(req: NextRequest) {
  await requireSession(req);
  try {
    const body = await req.json();
    const result = await checkLane({
      userMessage: String(body?.userMessage || ""),
      assistantMessage: String(body?.assistantMessage || ""),
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        chip: null,
        error: err instanceof Error ? err.message : "lane-check failed",
        code: "LANE_CHECK_FAILED",
      },
      { status: 200 }, // don't break chat on lane-check failure
    );
  }
}
