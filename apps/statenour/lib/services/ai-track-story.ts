/**
 * lib/services/ai-track-story.ts · actions-surface REST→tRPC slice
 * (2026-05-22 · legacy-modernizer · components/actions/* slice).
 *
 * The TRACK-page weekly-story narrator · lifted verbatim from
 * app/api/ai/track-story/route.ts so the legacy REST endpoint AND the
 * new `ai.trackStory` tRPC procedure call the SAME function · drift
 * between consumers structurally impossible.
 *
 * Takes the already-aggregated weekly counters (computed client-side so
 * this stays cheap) and returns a 2-3 sentence summary in Nick's voice.
 *
 * Returns the explicit flat `TrackStoryResult` shape — no Prisma row
 * reaches the AppRouter (TS2589 firewall satisfied trivially).
 */

import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { applyOperatorStyle } from "@/lib/ai/style-adapter";

/** The aggregated weekly snapshot the narrator reads. */
export interface TrackStoryInput {
  doneToday: number;
  thisWkDone: number;
  prevWkDone: number;
  warningCount: number;
  goalCount: number;
  projectCount: number;
  coldProjects: number;
  behindGoals: number;
  topStreak: number;
}

/** The generated weekly story. */
export interface TrackStoryResult {
  story: string;
  provider: string;
}

/**
 * Generate the 2-3 sentence weekly story. The REST route and the
 * `ai.trackStory` procedure both call this.
 */
export async function runTrackStory(
  body: TrackStoryInput,
): Promise<TrackStoryResult> {
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

  // Strategic Frameworks lens injection · weekly-story narration fires
  // North-Star-Metric / OKRs / Pareto on weekly stats.
  let lensBlock = "";
  try {
    const { pickFrameworks, composeStrategicLensBlock } = await import(
      "@/lib/ai/strategic-frameworks"
    );
    const { recordLensFire } = await import(
      "@/lib/ai/strategic-frameworks/record-lens-fire"
    );
    const lensInput = user.slice(0, 1200);
    lensBlock = composeStrategicLensBlock(lensInput);
    if (lensBlock) {
      const matches = pickFrameworks(lensInput);
      recordLensFire({
        surface: "track-story",
        matches,
        lensBlockLength: lensBlock.length,
      });
    }
  } catch {
    // best-effort · lens injection failures shouldn't break the AI call
  }

  // Append the operator's 8-axis style addendum to the system prompt.
  // The hard track-story rules stay authoritative · the addendum just
  // biases the within-rules style toward measured preferences.
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

  return {
    story: r.content.trim(),
    provider: r.provider,
  };
}
