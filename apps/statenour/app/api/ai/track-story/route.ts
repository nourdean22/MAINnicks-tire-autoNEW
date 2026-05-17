/**
 * POST /api/ai/track-story
 *
 * Apr 27 — TRACK page footer story. Takes a snapshot of the week's
 * counters and returns a 1-paragraph summary in Nick's voice. Hit
 * by KommandoTrack on first load + the regen button.
 *
 * Body shape (all numbers — already aggregated client-side so this
 * stays cheap and we don't double-compute):
 *   {
 *     doneToday, thisWkDone, prevWkDone, warningCount, goalCount,
 *     projectCount, coldProjects, behindGoals, topStreak
 *   }
 *
 * Returns: { story: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { z } from "zod";
// v10.0.529.34 · Arc B F7 · operator-style mimicry · the weekly
// track-story is prose · benefits from the same 8-axis dial /chat uses.
import { applyOperatorStyle } from "@/lib/ai/style-adapter";
import { safeParseBody, aiRouteError } from "@/lib/utils/http";

import { requireSession } from "@/lib/auth-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const schema = z.object({
  doneToday: z.number().int().nonnegative(),
  thisWkDone: z.number().int().nonnegative(),
  prevWkDone: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  goalCount: z.number().int().nonnegative(),
  projectCount: z.number().int().nonnegative(),
  coldProjects: z.number().int().nonnegative(),
  behindGoals: z.number().int().nonnegative(),
  topStreak: z.number().int().nonnegative(),
});

export async function POST(req: NextRequest) {
  await requireSession(req);
  const __aiLimit = checkAiRateLimit(req);
  if (__aiLimit) return __aiLimit; // v9.1.19 · cost-bomb guard
  try {
    // v8.0.1 — safeParse so bad input lands as 400 (not 500 + alert).
    const parsed = await safeParseBody(schema, req, "track-story");
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const trend =
      body.thisWkDone > body.prevWkDone
        ? "up"
        : body.thisWkDone < body.prevWkDone
          ? "down"
          : "flat";

    const system = `You are Nick — Nour's operator-grade ops mind. Voice rules:
- Direct, no fluff, no hedging
- 2-3 sentences max, ~50 words total
- Specific numbers from the snapshot, not vague qualifiers
- Honest read: call out wins AND drift
- One concrete suggestion at the end if there's clear action

Never start with "Looking at..." or "Based on..." — get straight to the point.
Never use emojis. Never say "great job."`;

    const user = `Snapshot:
- Done today: ${body.doneToday}
- Done this week: ${body.thisWkDone} (last week: ${body.prevWkDone}, trend: ${trend})
- Warnings to triage: ${body.warningCount}
- Goals: ${body.goalCount} active, ${body.behindGoals} behind pace
- Projects: ${body.projectCount} active, ${body.coldProjects} cold/dead
- Top streak: ${body.topStreak}d

Write the 2-3 sentence weekly story.`;

    // v10.0.287 · Strategic Frameworks lens injection (10th surface).
    // Weekly-story narration fires North-Star-Metric / OKRs / Pareto on
    // weekly stats — flags drift in metric framing or focus density.
    let lensBlock = "";
    try {
      const { pickFrameworks, composeStrategicLensBlock } = await import("@/lib/ai/strategic-frameworks");
      const { recordLensFire } = await import("@/lib/ai/strategic-frameworks/record-lens-fire");
      const lensInput = user.slice(0, 1200);
      lensBlock = composeStrategicLensBlock(lensInput);
      if (lensBlock) {
        const matches = pickFrameworks(lensInput);
        recordLensFire({ surface: "track-story", matches, lensBlockLength: lensBlock.length });
      }
    } catch {
      // best-effort · lens injection failures shouldn't break the AI call
    }

    // v10.0.529.34 · Arc B F7 · append the operator's 8-axis style
    // addendum to the system prompt. The hard track-story rules
    // (2-3 sentences max · ~50 words · no emojis · no "Looking at...")
    // stay authoritative · the addendum just biases the within-rules
    // style toward the operator's measured preferences.
    const styledSystem = await applyOperatorStyle(
      system + (lensBlock ? `\n\n${lensBlock}` : ""),
    );

    const r = await tracedAiChat(
      { label: "track-story", source: "tool" },
      [
        { role: "system", content: styledSystem },
        { role: "user", content: user },
      ],
      "fast",
    );

    return NextResponse.json({
      story: r.content.trim(),
      provider: r.provider,
    });
  } catch (e) {
    return aiRouteError(e, "track-story", "story failed");
  }
}
