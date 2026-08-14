/**
 * GET /api/ai/chat/media-transcript?videoId=…&segmenter=… · BDN-320
 *
 * Fetch timed transcript segments for media already in VideoDB.
 *
 * WHY A SEPARATE ROUTE FROM audio-transcribe
 * audio-transcribe does upload + index + poll + return in one shot, for
 * the drop-a-voice-memo flow. The transcript PANE needs the opposite:
 * the media is already uploaded and it wants timings for something it
 * can already play. Reusing audio-transcribe would re-upload a file that
 * is already there.
 *
 * Response:
 *   · 200 { text, segments, segmentsUnavailable, videoId }
 *       `segments` is [{start,end,text}] in seconds. `segmentsUnavailable`
 *       is true when text came back but no timings did — surfaced so an
 *       empty array is never silently read as "silent clip".
 *   · 400 missing videoId · bad segmenter
 *   · 503 VIDEO_DB_API_KEY missing
 *   · 504 still indexing when the poll budget ran out (retryable)
 *   · 500 with diagnostic otherwise
 *
 * Auth: requireSession.
 *
 * Poll budget is deliberately SHORT (6 attempts ≈ 12s). This is a
 * foreground fetch behind a visible pane, not a background job: the
 * client's 2-minute default would look like the pane had hung. A
 * still-indexing transcript returns 504 with a retry hint so the pane
 * can say "still transcribing" honestly instead of spinning.
 */

import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { aiRouteError } from "@/lib/utils/http-parse";
import { getTranscript, type TranscriptSegmenter } from "@/lib/videodb/client";

export const runtime = "nodejs";
export const maxDuration = 60;

const VALID_SEGMENTERS: readonly TranscriptSegmenter[] = ["word", "sentence", "time"];

export async function GET(req: NextRequest) {
  await requireSession(req);

  if (!process.env.VIDEO_DB_API_KEY) {
    return Response.json(
      {
        error: "VIDEO_DB_API_KEY not set",
        hint: "Get a free key at https://console.videodb.io · then set VIDEO_DB_API_KEY",
      },
      { status: 503 },
    );
  }

  const videoId = req.nextUrl.searchParams.get("videoId")?.trim();
  if (!videoId) {
    return Response.json({ error: "media-transcript: videoId is required" }, { status: 400 });
  }

  const segmenterParam = req.nextUrl.searchParams.get("segmenter") ?? "sentence";
  if (!VALID_SEGMENTERS.includes(segmenterParam as TranscriptSegmenter)) {
    return Response.json(
      { error: `media-transcript: segmenter must be one of ${VALID_SEGMENTERS.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const result = await getTranscript(videoId, {
      segmenter: segmenterParam as TranscriptSegmenter,
      maxAttempts: 6,
      pollMs: 2000,
    });
    return Response.json({ ...result, videoId });
  } catch (err) {
    // getTranscript throws "not ready after Ns" when the poll budget
    // expires. That is not a failure — it is "come back shortly", and
    // conflating the two makes a transcribing clip look broken.
    if (err instanceof Error && /not ready after/i.test(err.message)) {
      return Response.json(
        {
          error: "Transcript still being generated",
          videoId,
          retryable: true,
          hint: "VideoDB is still indexing spoken words for this media. Try again shortly.",
        },
        { status: 504 },
      );
    }
    return aiRouteError(err, "ai/chat/media-transcript", "Transcript fetch failed");
  }
}
