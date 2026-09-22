/**
 * Conversation-episode ingest — the shop-side sink for counter-audio capture.
 *
 * `camera-bridge/vision/officeaudio.py` runs on the SHOP PC (the office Eufy camera at
 * 192.168.0.167 is on that LAN and unreachable from anywhere else), turns the audio stream
 * into bounded interactions, and posts them here with their transcript. This stores the
 * episode and extracts the facts.
 *
 * THE MEASUREMENT THAT SHAPES THIS ROUTE. A 90-second office sample transcribed locally on
 * 2026-09-22 produced text for 37.4s of 90s. The unrecovered 50s carried NORMAL
 * conversational energy — -16.7 to -31.2 dB against -21 to -36 dB for the windows that DID
 * transcribe — so loudness says nothing about intelligibility here, and the 44% that returned
 * was semantically incoherent. A summariser fed that does not produce thin summaries; it
 * produces fluent, confident, WRONG ones.
 *
 * So `coveredSeconds` / `totalSeconds` are REQUIRED on every post. They are what lets the
 * extractor refuse: below 65% coverage no facts are emitted at all, however fluent the text
 * reads. The operator has chosen to keep the camera mic and iterate, and this gate is what
 * makes that safe — as the audio improves, coverage rises and facts begin flowing with no
 * code change.
 *
 * Fail closed on auth, like its camera siblings: no shared secret configured means 401, never
 * "allow".
 */
import type { Express, Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { extractConversationFacts, type TranscriptSegment } from "../services/conversationFacts";

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

const segmentSchema = z.object({
  index: z.number().int().min(0),
  start: z.number(),
  end: z.number(),
  text: z.string(),
});

const episodeSchema = z.object({
  episodeId: z.string().min(1).max(64),
  /** `eufy-office` today; `counter-mic` if the source changes. Nothing else here cares. */
  source: z.string().min(1).max(32),
  startedAt: z.union([z.string(), z.number(), z.null()]).optional(),
  durationSeconds: z.number().nullish(),
  audioRef: z.string().max(255).nullish(),
  /** Measured at capture. Nullish because a clip whose level could not be measured must stay
   *  distinguishable from one measured and found quiet. */
  meanVolumeDb: z.number().nullish(),
  segments: z.array(segmentSchema).default([]),
  sttEngine: z.string().max(32).nullish(),
  sttLatencyMs: z.number().int().nullish(),
  /**
   * REQUIRED, both of them. Coverage is the only signal that caught the real failure, and a
   * post that omits it would silently get the ungated path — which is exactly how a gappy
   * transcript would produce confident facts.
   */
  coveredSeconds: z.number().min(0),
  totalSeconds: z.number().min(0),
});

export function registerConversationEpisodeRoute(app: Express): void {
  app.post("/api/conversation-episodes", async (req: Request, res: Response) => {
    const key = process.env.CAMERA_INGEST_KEY || process.env.STATENOUR_SYNC_KEY || "";
    const provided = (req.headers["x-sync-key"] as string) || "";
    if (!key || !safeCompare(key, provided)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = episodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload", issues: parsed.error.issues.slice(0, 5) });
    }
    const e = parsed.data;

    const segments: TranscriptSegment[] = e.segments.map((s) => ({
      index: s.index, start: s.start, end: s.end, text: s.text,
    }));

    // Extraction runs BEFORE the write so the row lands complete. A two-step write would
    // leave a PENDING row behind whenever extraction failed, and nothing reaps those.
    const extracted = await extractConversationFacts(segments, {
      meanVolumeDb: e.meanVolumeDb ?? null,
      coveredSeconds: e.coveredSeconds,
      totalSeconds: e.totalSeconds,
    });

    // `ok:false` means extraction could not run. That is FAILED, not "no facts found" — the
    // distinction the whole service is arranged around, preserved at the boundary.
    const status = !extracted.ok ? "FAILED" : segments.length ? "DONE" : "SKIPPED";

    try {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (!d) return res.status(503).json({ error: "DB unavailable" });

      await d.execute(sql`
        INSERT INTO conversation_episodes
          (episodeId, source, startedAt, durationSeconds, audioRef, meanVolumeDb,
           transcriptStatus, transcriptError, transcript, sttEngine, sttLatencyMs,
           facts, summary)
        VALUES (
          ${e.episodeId}, ${e.source},
          ${e.startedAt ? new Date(typeof e.startedAt === "number" ? e.startedAt * 1000 : e.startedAt) : null},
          ${e.durationSeconds ?? null}, ${e.audioRef ?? null}, ${e.meanVolumeDb ?? null},
          ${status}, ${extracted.error}, ${JSON.stringify(segments)},
          ${e.sttEngine ?? null}, ${e.sttLatencyMs ?? null},
          ${JSON.stringify(extracted.facts)}, ${extracted.summary}
        )
        ON DUPLICATE KEY UPDATE
          transcriptStatus = VALUES(transcriptStatus),
          transcriptError  = VALUES(transcriptError),
          transcript       = VALUES(transcript),
          facts            = VALUES(facts),
          summary          = VALUES(summary),
          sttEngine        = VALUES(sttEngine),
          sttLatencyMs     = VALUES(sttLatencyMs),
          meanVolumeDb     = COALESCE(VALUES(meanVolumeDb), meanVolumeDb),
          audioRef         = VALUES(audioRef)
      `);
    } catch (err) {
      return res.status(500).json({
        error: "write failed",
        detail: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      });
    }

    // The reply reports what was DROPPED as well as what was kept. A caller that only sees a
    // fact count cannot tell a quiet conversation from a transcript the gate rejected, and
    // those call for opposite responses at the shop.
    return res.json({
      episodeId: e.episodeId,
      transcriptStatus: status,
      factsStored: extracted.facts.length,
      dropped: extracted.dropped,
      coverage: e.totalSeconds > 0 ? Number((e.coveredSeconds / e.totalSeconds).toFixed(3)) : null,
      engine: extracted.engine,
    });
  });
}
