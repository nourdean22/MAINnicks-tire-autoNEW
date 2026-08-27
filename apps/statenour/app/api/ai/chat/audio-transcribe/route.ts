/**
 * POST /api/ai/chat/audio-transcribe · audio drop → text via OpenAI
 * whisper-1 (2026-08-25 · VideoDB retired).
 *
 * HISTORY THIS ENCODES: the original v10.0.349 implementation uploaded
 * to VideoDB, indexed, and polled. It NEVER worked in production — the
 * client had four wire-format bugs found only by live probe (BDN-321),
 * and once those were fixed the account showed $0.00 credit, zero
 * lifetime uploads. Meanwhile /api/ai/transcribe (the mic path) had
 * been using whisper-1 as its PRIMARY all along. This route now uses
 * the same working dependency, with `verbose_json` so the timed
 * segments BDN-318/320 wanted come from the transcription itself.
 *
 * Body (multipart/form-data):
 *   · file: File — audio blob (mp3/wav/m4a/webm/ogg), ≤25MB (whisper cap)
 *   (the old `url` alternative was VideoDB-only and had no live caller —
 *    use-audio-transcribe.ts always sends a file)
 *
 * Response:
 *   · 200 { transcript, segments, segmentsUnavailable, elapsedMs }
 *     - `segments`: [{start,end,text}] seconds, straight from whisper's
 *       verbose_json. `segmentsUnavailable`: true when text came back
 *       without timings — explicit so an empty array is never mistaken
 *       for a silent clip.
 *   · 400 no/oversized file · 502 every configured STT lane failed
 *
 * Auth: requireSession (same as other chat endpoints).
 */

import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { transcribeAudio } from "@/lib/ai/stt";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { aiRouteError } from "@/lib/utils/http-parse";

// whisper-1's own request cap — the old 50MB VideoDB ceiling would just
// bounce off the upstream 413.
const MAX_BYTES = 25 * 1024 * 1024;
export const maxDuration = 240;

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export async function POST(req: NextRequest) {
  await requireSession(req);

  // Same 10/min/IP cap as /api/ai/transcribe, same rationale: this route
  // now reaches a WORKING metered API (it used to reach a dead $0
  // account, where "no rate limit" cost nothing).
  const rateLimited = checkAiRateLimit(req);
  if (rateLimited) return rateLimited;

  const startedAt = Date.now();
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return Response.json(
        { error: "audio-transcribe: multipart 'file' is required" },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return Response.json(
        { error: `Audio too large · max ${MAX_BYTES / 1024 / 1024}MB (whisper-1 limit)` },
        { status: 400 },
      );
    }
    const filename = file instanceof File && file.name ? file.name : `audio-${Date.now()}.webm`;

    // 2026-08-27 · whisper-only died with the revoked OPENAI_API_KEY —
    // same free-first chain as the mic route (lib/ai/stt.ts). Timed
    // segments come from lanes that provide verbose_json (groq/openai);
    // the hf lane returns plain text, so segmentsUnavailable stays an
    // explicit signal, never an empty array masquerading as silence.
    const result = await transcribeAudio(file, filename);
    const segments: TranscriptSegment[] = result.segments ?? [];

    return Response.json({
      transcript: result.text,
      segments,
      segmentsUnavailable: result.text.length > 0 && segments.length === 0,
      source: result.engine,
      degraded: result.degraded,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (err) {
    return aiRouteError(err, "ai/chat/audio-transcribe", "Audio transcribe failed");
  }
}
