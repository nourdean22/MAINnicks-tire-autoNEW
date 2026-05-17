/**
 * /api/cron/voice-clone-train · v8.1 · Apr 29.
 *
 * Mines Fireflies meeting transcripts for Nour's voice fingerprint
 * (hit-phrases, sentence length, cadence markers, opening words) and
 * persists a `voice_clone_profile` brain memory the chat layer pulls
 * into the Nour-voice lane.
 *
 * Weekly cadence — Mondays 10am Cleveland (15:00 UTC). Voice patterns
 * stabilize over the week's worth of transcripts; daily was overkill.
 *
 * Wired in config/crons.ts (v8.1 batch). Idempotency: each run writes
 * a new BrainMemory row (the persist already overwrites the existing
 * "current" key via upsert in trainVoiceClone), so retries are
 * functionally idempotent.
 */

import { cronHandler } from "@/lib/utils/http";
import { trainVoiceClone } from "@/lib/ai/voice-clone-trainer";

export const maxDuration = 120;

export const GET = cronHandler(async () => {
  const started = Date.now();
  try {
    const profile = await trainVoiceClone();
    return {
      ok: true,
      durationMs: Date.now() - started,
      hitPhraseCount: profile.hitPhrases.length,
      medianSentenceWords: profile.medianSentenceWords,
      p90SentenceWords: profile.p90SentenceWords,
      transcriptsAnalyzed: profile.transcriptsAnalyzed,
      nourSentenceCount: profile.nourSentenceCount,
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : "voice-clone train failed",
    };
  }
});
