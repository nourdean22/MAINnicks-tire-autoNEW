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
import {
  analyzeOfficeFrames, conversationEpisodeColumnReady, loadVisualCalibrationDetailed, officeVisualColumnReady,
  OFFICE_VISUAL_MAX_FRAMES,
  type OfficeVisual,
} from "../services/officeVisual";
import { createLogger } from "../lib/logger";

const log = createLogger("routes:conversationEpisodes");

/** How long fact extraction waits for the camera's description before going without it. */
const VISUAL_CONTEXT_WAIT_MS = 15_000;

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
  // Grouping label from diarization, never a human identity.
  speaker: z.string().max(64).optional(),
});

const episodeSchema = z.object({
  episodeId: z.string().min(1).max(64),
  /** `eufy-office` today; `counter-mic` if the source changes. Nothing else here cares. */
  source: z.string().min(1).max(32),
  cameraSerial: z.string().max(64).nullish(),
  captureHost: z.string().max(64).nullish(),
  triggerType: z.string().max(32).nullish(),
  triggeredAt: z.union([z.string(), z.number(), z.null()]).optional(),
  startedAt: z.union([z.string(), z.number(), z.null()]).optional(),
  durationSeconds: z.number().nullish(),
  audioRef: z.string().max(255).nullish(),
  /** Measured at capture. Nullish because a clip whose level could not be measured must stay
   *  distinguishable from one measured and found quiet. */
  meanVolumeDb: z.number().nullish(),
  segments: z.array(segmentSchema).default([]),
  sttEngine: z.string().max(32).nullish(),
  sttModel: z.string().max(128).nullish(),
  sttLatencyMs: z.number().int().nullish(),
  /** Distinct diarized speakers. NULL means diarization was not attempted. */
  speakerCount: z.number().int().min(0).nullish(),
  /**
   * Set by the producer when TRANSCRIPTION ITSELF failed: the model crashed, the audio was
   * unreadable, the binary was missing. Without it a producer whose transcriber died posts
   * `segments: []`, which is indistinguishable from a genuinely silent room and would store as
   * SKIPPED, a confident claim that nobody said anything. That is the empty-vs-error confusion
   * this whole feature is arranged against, one layer further out than the extractor can see.
   */
  transcriptError: z.string().max(500).nullish(),
  /**
   * REQUIRED, both of them. Coverage is the only signal that caught the real failure, and a
   * post that omits it would silently get the ungated path — which is exactly how a gappy
   * transcript would produce confident facts.
   */
  coveredSeconds: z.number().min(0),
  totalSeconds: z.number().min(0),
  /**
   * 2026-10-02 · office "watch". Still frames grabbed by the producer during the capture window
   * (OFFICE_VISUAL_ENABLED on NicksMax). Optional: producers without it post exactly what they
   * did before. The frames are sent to the vision model and then DROPPED: only the resulting
   * description is stored (services/officeVisual.ts). ~400 KB base64 cap per frame keeps a full
   * set well under the 2 MB global body limit.
   */
  frames: z.array(z.object({
    at: z.union([z.string(), z.number()]).optional(),
    mime: z.enum(["image/jpeg", "image/png"]).default("image/jpeg"),
    base64: z.string().min(100).max(400_000),
    /** Persons counted in this frame by the detector on NicksMax. null = not measured. */
    people: z.number().int().min(0).max(50).nullish(),
  })).max(OFFICE_VISUAL_MAX_FRAMES).optional(),
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
      index: s.index, start: s.start, end: s.end, text: s.text, speaker: s.speaker,
    }));

    // Visual analysis is only worth a vision call when there is somewhere to keep the result:
    // until migration 0140 adds the column (or while the column check itself cannot run), frames
    // are accepted and dropped unanalyzed, and the reply says so (visualStatus) rather than
    // pretending the camera saw nothing.
    const frames = e.frames ?? [];
    let visualReady = false;
    if (frames.length > 0 && process.env.OFFICE_VISUAL_ANALYSIS !== "0") {
      try {
        const { getDb } = await import("../db");
        const d0 = await getDb();
        visualReady = d0 ? await officeVisualColumnReady(d0) : false;
      } catch {
        visualReady = false;
      }
    }

    // Vision runs FIRST (when it can be stored) so its description can inform fact extraction:
    // "keys handed over" beside "here you go" is a different fact from the words alone. Measured
    // 2026-10-02 at 0.5-1.2 s per call, so the serial cost is small next to extraction.
    // Extraction still runs BEFORE the write so the row lands complete; a two-step write would
    // leave a PENDING row behind whenever extraction failed, and nothing reaps those.
    const counted = frames.map((f) => f.people).filter((n): n is number => typeof n === "number");
    const onBoxPeople = counted.length ? Math.max(...counted) : null;
    const visualPromise: Promise<OfficeVisual | null> = visualReady
      ? (async () => {
          let calibration: string[] = [];
          let calibrationFrom: string[] = [];
          try {
            const { getDb } = await import("../db");
            const dc = await getDb();
            if (dc) {
              const loaded = await loadVisualCalibrationDetailed(dc);
              calibration = loaded.notes;
              calibrationFrom = loaded.episodeIds;
            }
          } catch {
            calibration = [];
            calibrationFrom = [];
          }
          const v = await analyzeOfficeFrames(
            frames.map((f) => ({ mime: f.mime, base64: f.base64 })),
            undefined,
            { calibration, onBoxPeople },
          );
          // The receipt (audit N5): which reviewed episodes shaped this description. Stored on
          // the visual and logged below, so a Wrong review's consumption is a row, not a hope.
          return { ...v, onBoxPeople, calibrationFrom };
        })()
      : Promise.resolve(null);
    // Extraction waits for the camera context at most VISUAL_CONTEXT_WAIT_MS. Vision's own worst
    // case is 40 s per lane x 2 lanes; serialising that ahead of a 60 s extraction would outrun
    // the producer's 120 s post timeout. Past the wait, facts are extracted without context and
    // the description is still awaited and stored.
    let waitTimer: ReturnType<typeof setTimeout> | undefined;
    const early = await Promise.race([
      visualPromise,
      new Promise<null>((resolve) => { waitTimer = setTimeout(() => resolve(null), VISUAL_CONTEXT_WAIT_MS); }),
    ]).finally(() => clearTimeout(waitTimer));
    const visualContext = early?.status === "DONE" && early.summary
      ? [early.summary, early.activities.length ? `Activities: ${early.activities.join(", ")}.` : ""]
          .filter(Boolean).join(" ")
      : null;
    const [extracted, visual] = await Promise.all([
      extractConversationFacts(segments, {
        meanVolumeDb: e.meanVolumeDb ?? null,
        coveredSeconds: e.coveredSeconds,
        totalSeconds: e.totalSeconds,
        visualContext,
      }),
      visualPromise,
    ]);

    // FAILED covers BOTH failures that can reach here, and it outranks everything: the
    // producer could not transcribe, or extraction could not run. Neither is "no facts found".
    // transcriptError is checked FIRST because a dead transcriber yields an empty segment list,
    // which would otherwise score as SKIPPED.
    const status = e.transcriptError ? "FAILED"
      : !extracted.ok ? "FAILED"
      : segments.length ? "DONE"
      : "SKIPPED";
    // Keep BOTH reasons when both exist: a reader debugging a FAILED row needs to know whether
    // the audio never became text, or the text never became facts.
    const storedError = [e.transcriptError, extracted.error].filter(Boolean).join(" | ") || null;

    try {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (!d) return res.status(503).json({ error: "DB unavailable" });

      await d.execute(sql`
        INSERT INTO conversation_episodes
          (episodeId, source, cameraSerial, captureHost, triggerType, triggeredAt,
           startedAt, durationSeconds, audioRef, meanVolumeDb,
           transcriptStatus, transcriptError, transcript, sttEngine, sttModel, sttLatencyMs,
           speakerCount, facts, summary)
        VALUES (
          ${e.episodeId}, ${e.source}, ${e.cameraSerial ?? null}, ${e.captureHost ?? null},
          ${e.triggerType ?? null},
          ${e.triggeredAt ? new Date(typeof e.triggeredAt === "number" ? e.triggeredAt * 1000 : e.triggeredAt) : null},
          ${e.startedAt ? new Date(typeof e.startedAt === "number" ? e.startedAt * 1000 : e.startedAt) : null},
          ${e.durationSeconds ?? null}, ${e.audioRef ?? null}, ${e.meanVolumeDb ?? null},
          ${status}, ${storedError}, ${JSON.stringify(segments)},
          ${e.sttEngine ?? null}, ${e.sttModel ?? null}, ${e.sttLatencyMs ?? null},
          ${e.speakerCount ?? null},
          ${JSON.stringify(extracted.facts)}, ${extracted.summary}
        )
        ON DUPLICATE KEY UPDATE
          transcriptStatus = VALUES(transcriptStatus),
          transcriptError  = VALUES(transcriptError),
          transcript       = VALUES(transcript),
          facts            = VALUES(facts),
          summary          = VALUES(summary),
          sttEngine        = VALUES(sttEngine),
          sttModel         = VALUES(sttModel),
          sttLatencyMs     = VALUES(sttLatencyMs),
          speakerCount     = VALUES(speakerCount),
          cameraSerial     = COALESCE(VALUES(cameraSerial), cameraSerial),
          captureHost      = COALESCE(VALUES(captureHost), captureHost),
          triggerType      = COALESCE(VALUES(triggerType), triggerType),
          triggeredAt      = COALESCE(VALUES(triggeredAt), triggeredAt),
          meanVolumeDb     = COALESCE(VALUES(meanVolumeDb), meanVolumeDb),
          audioRef         = VALUES(audioRef)
      `);
      // Separate statement, written only when the column exists (visual is non-null only then),
      // so the main INSERT above stays byte-identical for every database state.
      if (visual) {
        await d.execute(sql`
          UPDATE conversation_episodes SET visual = ${JSON.stringify(visual)} WHERE episodeId = ${e.episodeId}
        `);
      }
      // 0141 · the one-sentence topic. Separate statement, only once the column exists, so the
      // main INSERT stays byte-identical on an unmigrated database. A NULL write clears a stale
      // gist when a re-post of the same episode no longer supports one.
      if (extracted.gist !== undefined && await conversationEpisodeColumnReady(d, "gist")) {
        await d.execute(sql`
          UPDATE conversation_episodes SET gist = ${extracted.gist ?? null} WHERE episodeId = ${e.episodeId}
        `);
      }
    } catch (err) {
      return res.status(500).json({
        error: "write failed",
        detail: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      });
    }

    // What extraction produced and why it dropped things: counts and reasons only, never the
    // transcript or the gist text (customer speech stays out of logs).
    log.info("conversation extracted", {
      episodeId: e.episodeId, transcriptStatus: status, segments: segments.length,
      coverage: e.totalSeconds > 0 ? Number((e.coveredSeconds / e.totalSeconds).toFixed(3)) : null,
      facts: extracted.facts.length, summary: Boolean(extracted.summary), gist: Boolean(extracted.gist),
      dropped: extracted.dropped, engine: extracted.engine, error: storedError,
    });

    const visualStatus = frames.length === 0 ? null
      : visual ? visual.status
      : process.env.OFFICE_VISUAL_ANALYSIS === "0" ? "DISABLED"
      : "NOT_STORED_VISUAL_COLUMN_UNAVAILABLE";
    // One line per episode that carried frames, so the logs alone answer "did the camera's
    // stills become a description?" Only the producer sees the reply; without this a DONE and a
    // silently skipped analysis looked identical from the server side.
    if (visualStatus) {
      const meta = {
        episodeId: e.episodeId, frames: frames.length, visualStatus,
        provider: visual?.provider ?? null, model: visual?.model ?? null,
        latencyMs: visual?.latencyMs ?? null, error: visual?.error ?? null, onBoxPeople,
        // Which operator reviews were in the prompt (ids, never their text): the N5 receipt.
        calibrationFrom: visual?.calibrationFrom ?? [],
      };
      if (visualStatus === "DONE") log.info("office visual stored", meta);
      else log.warn("office visual not stored", meta);
    }

    // The reply reports what was DROPPED as well as what was kept. A caller that only sees a
    // fact count cannot tell a quiet conversation from a transcript the gate rejected, and
    // those call for opposite responses at the shop.
    return res.json({
      episodeId: e.episodeId,
      transcriptStatus: status,
      transcriptError: storedError,
      factsStored: extracted.facts.length,
      summaryStored: Boolean(extracted.summary),
      gistStored: Boolean(extracted.gist),
      dropped: extracted.dropped,
      coverage: e.totalSeconds > 0 ? Number((e.coveredSeconds / e.totalSeconds).toFixed(3)) : null,
      engine: extracted.engine,
      speakerCount: e.speakerCount ?? null,
      framesReceived: frames.length,
      visualStatus,
      visualError: visual?.error ?? null,
      onBoxPeople,
    });
  });
}
